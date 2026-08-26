// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { BotV3TwapOracle } from "../src/BotV3TwapOracle.sol";

contract OracleTestToken {
    uint8 public immutable decimals;

    constructor(uint8 decimals_) {
        decimals = decimals_;
    }
}

contract MockV3Pool {
    address public immutable token0;
    address public immutable token1;
    uint24 public immutable fee;

    int56 private pastTickCumulative;
    int56 private currentTickCumulative;
    int24 private currentTick;
    uint128 public liquidity;
    uint128 private observedLiquidity;

    constructor(address token0_, address token1_, uint24 fee_) {
        token0 = token0_;
        token1 = token1_;
        fee = fee_;
    }

    function setObservation(int56 pastTickCumulative_, int56 currentTickCumulative_) external {
        pastTickCumulative = pastTickCumulative_;
        currentTickCumulative = currentTickCumulative_;
    }

    function setSlot0Tick(int24 tick_) external {
        currentTick = tick_;
    }

    function setLiquidity(uint128 liquidity_) external {
        liquidity = liquidity_;
    }

    function setObservedLiquidity(uint128 liquidity_) external {
        observedLiquidity = liquidity_;
    }

    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityX128s)
    {
        require(secondsAgos.length == 2, "secondsAgos");
        tickCumulatives = new int56[](2);
        tickCumulatives[0] = pastTickCumulative;
        tickCumulatives[1] = currentTickCumulative;
        secondsPerLiquidityX128s = new uint160[](2);
        uint128 historyLiquidity = observedLiquidity == 0 ? liquidity : observedLiquidity;
        if (historyLiquidity > 0) {
            secondsPerLiquidityX128s[1] =
                uint160((uint256(secondsAgos[0]) << 128) / uint256(historyLiquidity));
        }
    }

    function slot0()
        external
        view
        returns (
            uint160 sqrtPriceX96,
            int24 tick,
            uint16 observationIndex,
            uint16 observationCardinality,
            uint16 observationCardinalityNext,
            uint8 feeProtocol,
            bool unlocked
        )
    {
        return (0, currentTick, 0, 2, 2, 0, true);
    }
}

contract MockV3Factory {
    mapping(bytes32 => address) private pools;

    function register(address pool) external {
        MockV3Pool source = MockV3Pool(pool);
        pools[_key(source.token0(), source.token1(), source.fee())] = pool;
    }

    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address) {
        return pools[_key(tokenA, tokenB, fee)];
    }

    function _key(address tokenA, address tokenB, uint24 fee) private pure returns (bytes32) {
        (address first, address second) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        return keccak256(abi.encodePacked(first, second, fee));
    }
}

contract BotV3TwapOracleTest {
    uint32 private constant WINDOW = 900;
    uint24 private constant FEE = 3_000;
    uint128 private constant MIN_LIQUIDITY = 100;
    uint16 private constant MAX_SPOT_DEVIATION_BPS = 500;

    function testReturnsOneX18ForZeroTickWithEqualDecimals() external {
        (OracleTestToken base, OracleTestToken quote, MockV3Pool pool) = pair(18, 18, false);
        pool.setObservation(0, 0);
        pool.setSlot0Tick(0);
        pool.setLiquidity(MIN_LIQUIDITY);

        BotV3TwapOracle oracle = deploy(pool, base, quote);

        assertEq(oracle.priceX18(), 1e18);
    }

    function testRoundsNegativeMeanTickTowardNegativeInfinity() external {
        (OracleTestToken base, OracleTestToken quote, MockV3Pool pool) = pair(18, 18, false);
        pool.setObservation(0, -1);
        pool.setSlot0Tick(-1);
        pool.setLiquidity(MIN_LIQUIDITY);

        BotV3TwapOracle oracle = new BotV3TwapOracle(
            address(pool),
            address(registry(pool)),
            address(base),
            address(quote),
            2,
            MIN_LIQUIDITY,
            MAX_SPOT_DEVIATION_BPS
        );

        assertEq(oracle.priceX18(), 999_900_009_999_000_099);
    }

    function testQuotesCorrectlyWhenBaseIsPoolToken1() external {
        (OracleTestToken base, OracleTestToken quote, MockV3Pool pool) = pair(18, 18, true);
        pool.setObservation(0, int56(uint56(WINDOW)));
        pool.setSlot0Tick(1);
        pool.setLiquidity(MIN_LIQUIDITY);

        BotV3TwapOracle oracle = deploy(pool, base, quote);

        assertEq(oracle.priceX18(), 999_900_009_999_000_099);
    }

    function testNormalizesQuoteTokenDecimals() external {
        (OracleTestToken base, OracleTestToken quote, MockV3Pool pool) = pair(18, 6, false);
        pool.setObservation(0, 0);
        pool.setSlot0Tick(0);
        pool.setLiquidity(MIN_LIQUIDITY);

        BotV3TwapOracle oracle = deploy(pool, base, quote);

        assertEq(oracle.priceX18(), 1e30);
    }

    function testRejectsLowActiveLiquidity() external {
        (OracleTestToken base, OracleTestToken quote, MockV3Pool pool) = pair(18, 18, false);
        pool.setObservation(0, 0);
        pool.setSlot0Tick(0);
        pool.setLiquidity(MIN_LIQUIDITY - 1);
        BotV3TwapOracle oracle = deploy(pool, base, quote);

        expectRevertSelector(
            address(oracle),
            abi.encodeCall(BotV3TwapOracle.priceX18, ()),
            BotV3TwapOracle.InsufficientLiquidity.selector
        );
    }

    function testRejectsTransientLiquidityThatWasAbsentAcrossTheTwapWindow() external {
        (OracleTestToken base, OracleTestToken quote, MockV3Pool pool) = pair(18, 18, false);
        pool.setObservation(0, 0);
        pool.setSlot0Tick(0);
        pool.setLiquidity(MIN_LIQUIDITY);
        pool.setObservedLiquidity(MIN_LIQUIDITY - 1);
        BotV3TwapOracle oracle = deploy(pool, base, quote);

        expectRevertSelector(
            address(oracle),
            abi.encodeCall(BotV3TwapOracle.priceX18, ()),
            BotV3TwapOracle.InsufficientLiquidity.selector
        );
    }

    function testRejectsExcessiveSpotToTwapDeviation() external {
        (OracleTestToken base, OracleTestToken quote, MockV3Pool pool) = pair(18, 18, false);
        pool.setObservation(0, 0);
        pool.setSlot0Tick(1_000);
        pool.setLiquidity(MIN_LIQUIDITY);
        BotV3TwapOracle oracle = deploy(pool, base, quote);

        expectRevertSelector(
            address(oracle),
            abi.encodeCall(BotV3TwapOracle.priceX18, ()),
            BotV3TwapOracle.SpotTwapDeviationTooHigh.selector
        );
    }

    function testConstructorRejectsPoolWithDifferentTokens() external {
        OracleTestToken base = new OracleTestToken(18);
        OracleTestToken quote = new OracleTestToken(18);
        OracleTestToken other = new OracleTestToken(18);
        MockV3Pool pool = orderedPool(address(base), address(other));

        try new BotV3TwapOracle(
            address(pool),
            address(registry(pool)),
            address(base),
            address(quote),
            WINDOW,
            MIN_LIQUIDITY,
            MAX_SPOT_DEVIATION_BPS
        ) {
            revert("expected InvalidPoolTokens");
        } catch (bytes memory reason) {
            assertSelector(reason, BotV3TwapOracle.InvalidPoolTokens.selector);
        }
    }

    /// @dev A pool holding the right pair that the factory never deployed is
    ///      the shape an attacker-seeded clone or a mistyped sibling fee tier
    ///      takes. The pair check alone accepts it; the factory check must not.
    function testConstructorRejectsPoolTheFactoryDidNotDeploy() external {
        (OracleTestToken base, OracleTestToken quote, MockV3Pool pool) = pair(18, 18, false);
        MockV3Factory factory = new MockV3Factory();

        try new BotV3TwapOracle(
            address(pool),
            address(factory),
            address(base),
            address(quote),
            WINDOW,
            MIN_LIQUIDITY,
            MAX_SPOT_DEVIATION_BPS
        ) {
            revert("expected PoolNotCanonical");
        } catch (bytes memory reason) {
            assertSelector(reason, BotV3TwapOracle.PoolNotCanonical.selector);
        }
    }

    /// @dev The same pair at a different fee tier is a real, deployed pool. The
    ///      oracle must bind to the address it was given, not to any pool the
    ///      factory happens to hold for the pair.
    function testConstructorRejectsSiblingFeeTierRegisteredForTheSamePair() external {
        (OracleTestToken base, OracleTestToken quote, MockV3Pool pool) = pair(18, 18, false);
        MockV3Pool sibling = address(base) < address(quote)
            ? new MockV3Pool(address(base), address(quote), 500)
            : new MockV3Pool(address(quote), address(base), 500);
        MockV3Factory factory = new MockV3Factory();
        factory.register(address(sibling));

        try new BotV3TwapOracle(
            address(pool),
            address(factory),
            address(base),
            address(quote),
            WINDOW,
            MIN_LIQUIDITY,
            MAX_SPOT_DEVIATION_BPS
        ) {
            revert("expected PoolNotCanonical");
        } catch (bytes memory reason) {
            assertSelector(reason, BotV3TwapOracle.PoolNotCanonical.selector);
        }
    }

    function testConstructorRejectsZeroFactory() external {
        (OracleTestToken base, OracleTestToken quote, MockV3Pool pool) = pair(18, 18, false);

        try new BotV3TwapOracle(
            address(pool),
            address(0),
            address(base),
            address(quote),
            WINDOW,
            MIN_LIQUIDITY,
            MAX_SPOT_DEVIATION_BPS
        ) {
            revert("expected ZeroAddress");
        } catch (bytes memory reason) {
            assertSelector(reason, BotV3TwapOracle.ZeroAddress.selector);
        }
    }

    function deploy(MockV3Pool pool, OracleTestToken base, OracleTestToken quote)
        private
        returns (BotV3TwapOracle)
    {
        return new BotV3TwapOracle(
            address(pool),
            address(registry(pool)),
            address(base),
            address(quote),
            WINDOW,
            MIN_LIQUIDITY,
            MAX_SPOT_DEVIATION_BPS
        );
    }

    /// @dev A factory that has deployed exactly this pool, so the canonical
    ///      check passes and each test isolates the behavior it names.
    function registry(MockV3Pool pool) private returns (MockV3Factory factory) {
        factory = new MockV3Factory();
        factory.register(address(pool));
    }

    function pair(uint8 baseDecimals, uint8 quoteDecimals, bool baseIsToken1)
        private
        returns (OracleTestToken base, OracleTestToken quote, MockV3Pool pool)
    {
        if (baseDecimals == quoteDecimals) {
            OracleTestToken first = new OracleTestToken(baseDecimals);
            OracleTestToken second = new OracleTestToken(quoteDecimals);
            bool firstIsLower = address(first) < address(second);
            if (baseIsToken1) {
                base = firstIsLower ? second : first;
                quote = firstIsLower ? first : second;
            } else {
                base = firstIsLower ? first : second;
                quote = firstIsLower ? second : first;
            }
        } else {
            base = new OracleTestToken(baseDecimals);
            quote = new OracleTestToken(quoteDecimals);
        }
        pool = orderedPool(address(base), address(quote));
    }

    function orderedPool(address first, address second) private returns (MockV3Pool) {
        return
            first < second ? new MockV3Pool(first, second, FEE) : new MockV3Pool(second, first, FEE);
    }

    function expectRevertSelector(address target, bytes memory callData, bytes4 expected) private {
        (bool ok, bytes memory reason) = target.call(callData);
        require(!ok, "expected revert");
        assertSelector(reason, expected);
    }

    function assertSelector(bytes memory reason, bytes4 expected) private pure {
        require(reason.length >= 4, "missing selector");
        bytes4 actual;
        assembly {
            actual := mload(add(reason, 32))
        }
        require(actual == expected, "wrong selector");
    }

    function assertEq(uint256 actual, uint256 expected) private pure {
        require(actual == expected, "uint256 neq");
    }
}
