// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { NyxBatchAuction } from "../src/NyxBatchAuction.sol";
import { INyxBatchAuction } from "../src/interfaces/INyxBatchAuction.sol";

interface CanaryVm {
    function prank(address sender) external;
    function expectRevert(bytes4 selector) external;
    function warp(uint256 timestamp) external;
}

contract CanaryToken {
    uint8 public immutable decimals;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(uint8 decimals_) {
        decimals = decimals_;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "allowance");
        allowance[from][msg.sender] = allowed - amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract CanaryPriceOracle {
    address public immutable baseToken;
    address public immutable quoteToken;
    address public immutable token0;
    address public immutable token1;
    uint256 public priceX18;

    constructor(address baseToken_, address quoteToken_, uint256 priceX18_) {
        baseToken = baseToken_;
        quoteToken = quoteToken_;
        token0 = quoteToken_;
        token1 = baseToken_;
        priceX18 = priceX18_;
    }

    function setPrice(uint256 priceX18_) external {
        priceX18 = priceX18_;
    }

    function getReserves() external pure returns (uint112, uint112, uint32) {
        // Deliberately reports a 20 quote/base V2 ratio. The normalized oracle
        // price above is 10, so a regression to reserve pricing fails loudly.
        return (20, 1, 0);
    }
}

contract NyxCanaryControlsTest {
    CanaryVm private constant vm =
        CanaryVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 private constant ONE_BASE = 1e18;
    uint256 private constant TEN_QUOTE = 10e6;
    uint256 private constant PRICE_X18 = 10e18;

    bytes4 private constant RISK_LIMITS_UNSET = bytes4(keccak256("RiskLimitsUnset()"));
    bytes4 private constant TRADER_NOT_ALLOWED = bytes4(keccak256("TraderNotAllowed()"));
    bytes4 private constant ORDER_CAP_EXCEEDED = bytes4(keccak256("OrderCapExceeded()"));
    bytes4 private constant PAUSED = bytes4(keccak256("Paused()"));
    bytes4 private constant ONLY_PENDING_OWNER = bytes4(keccak256("OnlyPendingOwner()"));
    bytes4 private constant CANCEL_DELAY_NOT_ELAPSED = bytes4(keccak256("CancelDelayNotElapsed()"));
    bytes4 private constant INVALID_EXPIRY = bytes4(keccak256("InvalidExpiry()"));
    bytes4 private constant SELF_TRADE = bytes4(keccak256("SelfTrade()"));
    bytes4 private constant TOO_MANY_MATCHED_ORDERS = bytes4(keccak256("TooManyMatchedOrders()"));

    address private owner = address(0xA11CE);
    address private nextOwner = address(0xB0B0);
    address private agent = address(0xA6E17);
    address private alice = address(0xA11A);
    address private bob = address(0xB0B);
    address private charlie = address(0xC0FFEE);

    struct ExpiringReveal {
        address trader;
        uint64 batchId;
        address sellToken;
        uint256 sellAmount;
        uint256 minBuyAmount;
        uint64 expiresAt;
        bytes32 salt;
    }

    function testUsesNormalizedOracleInsteadOfLegacyPairReserves() external {
        (NyxBatchAuction auction,,,) = deployAuction();
        assertEq(auction.getReferencePriceX18(), PRICE_X18);
    }

    function testStartsPausedAndCannotOpenWithoutBothTokenLimits() external {
        (NyxBatchAuction auction, CanaryToken base,,) = deployAuction();
        assertTrue(readBool(address(auction), "paused()"));

        callAsOwner(
            auction,
            abi.encodeWithSignature(
                "setRiskLimits(address,uint256,uint256,uint256)",
                address(base),
                ONE_BASE,
                2 * ONE_BASE,
                3 * ONE_BASE
            )
        );
        expectOwnerRevert(auction, abi.encodeWithSignature("unpause()"), RISK_LIMITS_UNSET);
    }

    function testAllowlistAndPerOrderCapGateEscrow() external {
        (NyxBatchAuction auction, CanaryToken base, CanaryToken quote,) = deployAuction();
        configureAndOpen(auction, base, quote, alice, bob);

        base.mint(charlie, ONE_BASE);
        approve(charlie, base, auction, ONE_BASE);
        bytes32 blockedCommitment = keccak256("blocked");
        vm.expectRevert(TRADER_NOT_ALLOWED);
        vm.prank(charlie);
        auction.submitOrder(
            1, blockedCommitment, address(base), ONE_BASE, uint64(block.timestamp + 1 days)
        );

        base.mint(alice, 2 * ONE_BASE);
        approve(alice, base, auction, 2 * ONE_BASE);
        vm.expectRevert(ORDER_CAP_EXCEEDED);
        vm.prank(alice);
        auction.submitOrder(
            1, keccak256("too-large"), address(base), 2 * ONE_BASE, uint64(block.timestamp + 1 days)
        );

        submit(auction, alice, base, keccak256("allowed"), ONE_BASE);
        assertEq(readUint(address(auction), "totalEscrowed(address)", address(base)), ONE_BASE);
        assertEq(
            readUint(address(auction), "batchEscrowed(uint64,address)", uint64(1), address(base)),
            ONE_BASE
        );
    }

    function testPauseBlocksNewRiskButNeverBlocksStaleExit() external {
        (NyxBatchAuction auction, CanaryToken base, CanaryToken quote,) = deployAuction();
        configureAndOpen(auction, base, quote, alice, bob);
        setAllowed(auction, charlie, true);

        INyxBatchAuction.OrderReveal memory aliceOrder =
            order(alice, address(base), ONE_BASE, TEN_QUOTE, keccak256("alice"));
        INyxBatchAuction.OrderReveal memory bobOrder =
            order(bob, address(quote), TEN_QUOTE, ONE_BASE, keccak256("bob"));
        bytes32 aliceCommitment = auction.hashOrder(aliceOrder);
        bytes32 bobCommitment = auction.hashOrder(bobOrder);
        bytes32 staleCommitment = keccak256("stale");
        submit(auction, alice, base, aliceCommitment, ONE_BASE);
        submit(auction, bob, quote, bobCommitment, TEN_QUOTE);
        submit(auction, charlie, base, staleCommitment, ONE_BASE);

        callAsOwner(auction, abi.encodeWithSignature("pause()"));
        vm.expectRevert(PAUSED);
        vm.prank(agent);
        auction.settleBatch(
            1, PRICE_X18, 0, matched(aliceCommitment, aliceOrder, bobCommitment, bobOrder)
        );

        callAsOwner(auction, abi.encodeWithSignature("unpause()"));
        vm.prank(agent);
        auction.settleBatch(
            1, PRICE_X18, 0, matched(aliceCommitment, aliceOrder, bobCommitment, bobOrder)
        );

        callAsOwner(auction, abi.encodeWithSignature("pause()"));
        uint256 before = base.balanceOf(charlie);
        vm.prank(charlie);
        auction.cancelOrder(staleCommitment);
        assertEq(base.balanceOf(charlie), before + ONE_BASE);
        assertEq(readUint(address(auction), "totalEscrowed(address)", address(base)), 0);
    }

    function testOwnershipMovesOnlyAfterPendingOwnerAccepts() external {
        (NyxBatchAuction auction,,,) = deployAuction();
        callAsOwner(auction, abi.encodeWithSignature("transferOwnership(address)", nextOwner));

        expectCallRevert(
            alice,
            address(auction),
            abi.encodeWithSignature("acceptOwnership()"),
            ONLY_PENDING_OWNER
        );
        require(
            call(nextOwner, address(auction), abi.encodeWithSignature("acceptOwnership()")),
            "accept"
        );
        assertEq(auction.owner(), nextOwner);
    }

    function testExpiryIsCommittedAndAllowsExitBeforeTheFallbackDelay() external {
        (NyxBatchAuction auction, CanaryToken base, CanaryToken quote,) = deployAuction();
        configureAndOpen(auction, base, quote, alice, bob);
        uint64 expiresAt = uint64(block.timestamp + 30 minutes);
        ExpiringReveal memory reveal = ExpiringReveal({
            trader: alice,
            batchId: 1,
            sellToken: address(base),
            sellAmount: ONE_BASE,
            minBuyAmount: TEN_QUOTE,
            expiresAt: expiresAt,
            salt: keccak256("expiring")
        });
        bytes32 commitment = hashExpiringOrder(auction, reveal);
        ExpiringReveal memory later = reveal;
        later.expiresAt++;
        require(commitment != hashExpiringOrder(auction, later), "expiry not committed");

        base.mint(alice, ONE_BASE);
        approve(alice, base, auction, ONE_BASE);
        require(
            call(
                alice,
                address(auction),
                abi.encodeWithSignature(
                    "submitOrder(uint64,bytes32,address,uint256,uint64)",
                    uint64(1),
                    commitment,
                    address(base),
                    ONE_BASE,
                    expiresAt
                )
            ),
            "expiring submit failed"
        );

        expectCallRevert(
            alice,
            address(auction),
            abi.encodeCall(NyxBatchAuction.cancelOrder, (commitment)),
            CANCEL_DELAY_NOT_ELAPSED
        );
        vm.warp(expiresAt);
        require(
            call(
                alice, address(auction), abi.encodeCall(NyxBatchAuction.cancelOrder, (commitment))
            ),
            "expiry cancel failed"
        );
        assertEq(base.balanceOf(alice), ONE_BASE);
    }

    function testRejectsExpiryBeyondMaximumLockWindow() external {
        (NyxBatchAuction auction, CanaryToken base, CanaryToken quote,) = deployAuction();
        configureAndOpen(auction, base, quote, alice, bob);
        uint64 expiresAt = uint64(block.timestamp + 2 days + 1);
        base.mint(alice, ONE_BASE);
        approve(alice, base, auction, ONE_BASE);

        expectCallRevert(
            alice,
            address(auction),
            abi.encodeWithSignature(
                "submitOrder(uint64,bytes32,address,uint256,uint64)",
                uint64(1),
                keccak256("too-late"),
                address(base),
                ONE_BASE,
                expiresAt
            ),
            INVALID_EXPIRY
        );
    }

    function testSettlementRejectsCrossSideSelfTrade() external {
        (NyxBatchAuction auction, CanaryToken base, CanaryToken quote,) = deployAuction();
        configureAndOpen(auction, base, quote, alice, bob);
        setAllowed(auction, charlie, true);
        INyxBatchAuction.OrderReveal memory sellBase =
            order(charlie, address(base), ONE_BASE, TEN_QUOTE, keccak256("self-base"));
        INyxBatchAuction.OrderReveal memory sellQuote =
            order(charlie, address(quote), TEN_QUOTE, ONE_BASE, keccak256("self-quote"));
        bytes32 baseCommitment = auction.hashOrder(sellBase);
        bytes32 quoteCommitment = auction.hashOrder(sellQuote);
        submit(auction, charlie, base, baseCommitment, ONE_BASE);
        submit(auction, charlie, quote, quoteCommitment, TEN_QUOTE);

        vm.expectRevert(SELF_TRADE);
        vm.prank(agent);
        auction.settleBatch(
            1, PRICE_X18, 0, matched(baseCommitment, sellBase, quoteCommitment, sellQuote)
        );
    }

    function testSettlementCapsMatchedOrderCount() external {
        (NyxBatchAuction auction, CanaryToken base, CanaryToken quote,) = deployAuction();
        configureAndOpen(auction, base, quote, alice, bob);
        INyxBatchAuction.MatchedOrder[] memory orders = new INyxBatchAuction.MatchedOrder[](65);

        vm.expectRevert(TOO_MANY_MATCHED_ORDERS);
        vm.prank(agent);
        auction.settleBatch(1, PRICE_X18, 0, orders);
    }

    function deployAuction()
        private
        returns (
            NyxBatchAuction auction,
            CanaryToken base,
            CanaryToken quote,
            CanaryPriceOracle oracle
        )
    {
        base = new CanaryToken(18);
        quote = new CanaryToken(6);
        oracle = new CanaryPriceOracle(address(base), address(quote), PRICE_X18);
        vm.prank(owner);
        auction = new NyxBatchAuction(
            address(base), address(quote), address(oracle), agent, 2 days, 1_000
        );
    }

    function configureAndOpen(
        NyxBatchAuction auction,
        CanaryToken base,
        CanaryToken quote,
        address first,
        address second
    ) private {
        callAsOwner(
            auction,
            abi.encodeWithSignature(
                "setRiskLimits(address,uint256,uint256,uint256)",
                address(base),
                ONE_BASE,
                3 * ONE_BASE,
                4 * ONE_BASE
            )
        );
        callAsOwner(
            auction,
            abi.encodeWithSignature(
                "setRiskLimits(address,uint256,uint256,uint256)",
                address(quote),
                TEN_QUOTE,
                3 * TEN_QUOTE,
                4 * TEN_QUOTE
            )
        );
        setAllowed(auction, first, true);
        setAllowed(auction, second, true);
        callAsOwner(auction, abi.encodeWithSignature("unpause()"));
    }

    function setAllowed(NyxBatchAuction auction, address trader, bool allowed) private {
        callAsOwner(
            auction, abi.encodeWithSignature("setAllowedTrader(address,bool)", trader, allowed)
        );
    }

    function submit(
        NyxBatchAuction auction,
        address trader,
        CanaryToken token,
        bytes32 commitment,
        uint256 amount
    ) private {
        token.mint(trader, amount);
        approve(trader, token, auction, amount);
        vm.prank(trader);
        auction.submitOrder(1, commitment, address(token), amount, uint64(block.timestamp + 1 days));
    }

    function approve(address trader, CanaryToken token, NyxBatchAuction auction, uint256 amount)
        private
    {
        vm.prank(trader);
        token.approve(address(auction), amount);
    }

    function order(
        address trader,
        address sellToken,
        uint256 sellAmount,
        uint256 minBuyAmount,
        bytes32 salt
    ) private view returns (INyxBatchAuction.OrderReveal memory) {
        return INyxBatchAuction.OrderReveal({
            trader: trader,
            batchId: 1,
            sellToken: sellToken,
            sellAmount: sellAmount,
            minBuyAmount: minBuyAmount,
            expiresAt: uint64(block.timestamp + 1 days),
            salt: salt
        });
    }

    function matched(
        bytes32 firstCommitment,
        INyxBatchAuction.OrderReveal memory first,
        bytes32 secondCommitment,
        INyxBatchAuction.OrderReveal memory second
    ) private pure returns (INyxBatchAuction.MatchedOrder[] memory orders) {
        orders = new INyxBatchAuction.MatchedOrder[](2);
        orders[0] = INyxBatchAuction.MatchedOrder(firstCommitment, first);
        orders[1] = INyxBatchAuction.MatchedOrder(secondCommitment, second);
    }

    function callAsOwner(NyxBatchAuction auction, bytes memory data) private {
        require(call(owner, address(auction), data), "owner call failed");
    }

    function expectOwnerRevert(NyxBatchAuction auction, bytes memory data, bytes4 selector)
        private
    {
        expectCallRevert(owner, address(auction), data, selector);
    }

    function expectCallRevert(address sender, address target, bytes memory data, bytes4 selector)
        private
    {
        vm.prank(sender);
        (bool ok, bytes memory reason) = target.call(data);
        require(!ok, "expected revert");
        require(reason.length >= 4, "missing selector");
        bytes4 actual;
        assembly {
            actual := mload(add(reason, 32))
        }
        require(actual == selector, "wrong selector");
    }

    function call(address sender, address target, bytes memory data) private returns (bool ok) {
        vm.prank(sender);
        (ok,) = target.call(data);
    }

    function hashExpiringOrder(NyxBatchAuction auction, ExpiringReveal memory reveal)
        private
        view
        returns (bytes32 commitment)
    {
        (bool ok, bytes memory data) = address(auction)
            .staticcall(
                abi.encodeWithSignature(
                    "hashOrder((address,uint64,address,uint256,uint256,uint64,bytes32))", reveal
                )
            );
        require(ok && data.length == 32, "expiring hash failed");
        commitment = abi.decode(data, (bytes32));
    }

    function readBool(address target, string memory signature) private view returns (bool value) {
        (bool ok, bytes memory data) = target.staticcall(abi.encodeWithSignature(signature));
        require(ok && data.length == 32, "bool read failed");
        value = abi.decode(data, (bool));
    }

    function readUint(address target, string memory signature, address arg)
        private
        view
        returns (uint256 value)
    {
        (bool ok, bytes memory data) = target.staticcall(abi.encodeWithSignature(signature, arg));
        require(ok && data.length == 32, "uint read failed");
        value = abi.decode(data, (uint256));
    }

    function readUint(address target, string memory signature, uint64 first, address second)
        private
        view
        returns (uint256 value)
    {
        (bool ok, bytes memory data) =
            target.staticcall(abi.encodeWithSignature(signature, first, second));
        require(ok && data.length == 32, "uint read failed");
        value = abi.decode(data, (uint256));
    }

    function assertEq(uint256 actual, uint256 expected) private pure {
        require(actual == expected, "uint neq");
    }

    function assertEq(address actual, address expected) private pure {
        require(actual == expected, "address neq");
    }

    function assertTrue(bool value) private pure {
        require(value, "not true");
    }
}
