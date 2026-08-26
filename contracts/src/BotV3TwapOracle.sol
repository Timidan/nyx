// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { INyxPriceOracle } from "./interfaces/INyxPriceOracle.sol";
import { V3OracleMath } from "./libraries/V3OracleMath.sol";

interface IERC20Decimals {
    function decimals() external view returns (uint8);
}

interface IUniswapV3Factory {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address);
}

interface IUniswapV3PoolOracle {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function fee() external view returns (uint24);
    function liquidity() external view returns (uint128);
    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityX128s);
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
        );
}

/// @notice BOT V3 time-weighted oracle for one Nyx base/quote pair.
/// @dev Fails closed when active liquidity is too low, observation history is
///      unavailable, or current spot has diverged too far from the TWAP.
contract BotV3TwapOracle is INyxPriceOracle {
    uint16 private constant BPS_DENOMINATOR = 10_000;
    uint16 private constant MAX_DEVIATION_BPS = 2_000;
    uint8 private constant MAX_SUPPORTED_DECIMALS = 18;

    address public immutable pool;
    address public immutable factory;
    address public immutable baseToken;
    address public immutable quoteToken;
    uint32 public immutable twapWindow;
    uint128 public immutable minLiquidity;
    uint16 public immutable maxSpotTwapDeviationBps;

    uint8 private immutable baseDecimals;
    uint8 private immutable quoteDecimals;

    error ZeroAddress();
    error InvalidWindow();
    error InvalidLiquidityFloor();
    error InvalidDeviationBps();
    error InvalidPoolTokens();
    error PoolNotCanonical();
    error UnsupportedDecimals();
    error InsufficientLiquidity();
    error SpotTwapDeviationTooHigh();
    error ZeroPrice();

    constructor(
        address pool_,
        address factory_,
        address baseToken_,
        address quoteToken_,
        uint32 twapWindow_,
        uint128 minLiquidity_,
        uint16 maxSpotTwapDeviationBps_
    ) {
        if (
            pool_ == address(0) || factory_ == address(0) || baseToken_ == address(0)
                || quoteToken_ == address(0)
        ) {
            revert ZeroAddress();
        }
        if (baseToken_ == quoteToken_) revert InvalidPoolTokens();
        if (twapWindow_ == 0) revert InvalidWindow();
        if (minLiquidity_ == 0) revert InvalidLiquidityFloor();
        if (maxSpotTwapDeviationBps_ > MAX_DEVIATION_BPS) revert InvalidDeviationBps();

        address poolToken0 = IUniswapV3PoolOracle(pool_).token0();
        address poolToken1 = IUniswapV3PoolOracle(pool_).token1();
        bool tokensMatch = (poolToken0 == baseToken_ && poolToken1 == quoteToken_)
            || (poolToken0 == quoteToken_ && poolToken1 == baseToken_);
        if (!tokensMatch) revert InvalidPoolTokens();

        // The pair check alone is satisfied by any pool holding these two
        // tokens, including a shallow sibling fee tier or an attacker-seeded
        // clone. Ask the canonical factory to confirm this exact address is the
        // pool it deployed for the pair and fee tier.
        uint24 poolFee = IUniswapV3PoolOracle(pool_).fee();
        if (IUniswapV3Factory(factory_).getPool(poolToken0, poolToken1, poolFee) != pool_) {
            revert PoolNotCanonical();
        }

        uint8 baseDecimals_ = IERC20Decimals(baseToken_).decimals();
        uint8 quoteDecimals_ = IERC20Decimals(quoteToken_).decimals();
        if (baseDecimals_ > MAX_SUPPORTED_DECIMALS || quoteDecimals_ > MAX_SUPPORTED_DECIMALS) {
            revert UnsupportedDecimals();
        }

        pool = pool_;
        factory = factory_;
        baseToken = baseToken_;
        quoteToken = quoteToken_;
        twapWindow = twapWindow_;
        minLiquidity = minLiquidity_;
        maxSpotTwapDeviationBps = maxSpotTwapDeviationBps_;
        baseDecimals = baseDecimals_;
        quoteDecimals = quoteDecimals_;
    }

    function priceX18() external view returns (uint256 twapPriceX18) {
        IUniswapV3PoolOracle source = IUniswapV3PoolOracle(pool);
        if (source.liquidity() < minLiquidity) revert InsufficientLiquidity();

        (int24 meanTick, uint128 harmonicMeanLiquidity) = _consult(source);
        if (harmonicMeanLiquidity < minLiquidity) revert InsufficientLiquidity();
        (, int24 spotTick,,,,,) = source.slot0();
        twapPriceX18 = _priceAtTick(meanTick);
        uint256 spotPriceX18 = _priceAtTick(spotTick);
        if (twapPriceX18 == 0 || spotPriceX18 == 0) revert ZeroPrice();

        uint256 delta =
            twapPriceX18 > spotPriceX18 ? twapPriceX18 - spotPriceX18 : spotPriceX18 - twapPriceX18;
        uint256 deviationBps = V3OracleMath.mulDiv(delta, BPS_DENOMINATOR, twapPriceX18);
        if (deviationBps > maxSpotTwapDeviationBps) revert SpotTwapDeviationTooHigh();
    }

    function _consult(IUniswapV3PoolOracle source)
        private
        view
        returns (int24 meanTick, uint128 harmonicMeanLiquidity)
    {
        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = twapWindow;
        secondsAgos[1] = 0;
        (int56[] memory cumulativeTicks, uint160[] memory cumulativeLiquidity) =
            source.observe(secondsAgos);
        int56 delta = cumulativeTicks[1] - cumulativeTicks[0];
        int56 divisor = int56(uint56(twapWindow));
        // Tick cumulatives divided by the same uint32 window always fit int24.
        // forge-lint: disable-next-line(unsafe-typecast)
        meanTick = int24(delta / divisor);
        if (delta < 0 && delta % divisor != 0) meanTick--;

        uint160 liquidityDelta;
        unchecked {
            // The V3 accumulator is uint160 and is explicitly allowed to wrap.
            liquidityDelta = cumulativeLiquidity[1] - cumulativeLiquidity[0];
        }
        if (liquidityDelta == 0) revert InsufficientLiquidity();
        uint256 harmonic = (uint256(twapWindow) << 128) / uint256(liquidityDelta);
        // The branch caps values above uint128 before this conversion.
        // forge-lint: disable-next-line(unsafe-typecast)
        harmonicMeanLiquidity = harmonic > type(uint128).max ? type(uint128).max : uint128(harmonic);
    }

    function _priceAtTick(int24 tick) private view returns (uint256) {
        uint128 oneBaseToken = uint128(10 ** baseDecimals);
        uint256 quoteAmount = V3OracleMath.quoteAtTick(tick, oneBaseToken, baseToken, quoteToken);
        return V3OracleMath.mulDiv(quoteAmount, 1e18, 10 ** quoteDecimals);
    }
}
