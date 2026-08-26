// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { NyxBatchAuction } from "../src/NyxBatchAuction.sol";
import { INyxBatchAuction } from "../src/interfaces/INyxBatchAuction.sol";

interface Vm {
    function prank(address msgSender) external;
    function startPrank(address msgSender) external;
    function stopPrank() external;
    function expectRevert(bytes4 revertData) external;
    function expectEmit(
        bool checkTopic1,
        bool checkTopic2,
        bool checkTopic3,
        bool checkData,
        address emitter
    ) external;
    function warp(uint256 newTimestamp) external;
}

contract MockERC20 {
    string public name;
    string public symbol;
    uint8 public immutable decimals;
    uint256 public totalSupply;
    uint256 public feeBps;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool) public blockedRecipients;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) {
        name = name_;
        symbol = symbol_;
        decimals = decimals_;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }

    function setFeeBps(uint256 feeBps_) external {
        feeBps = feeBps_;
    }

    function setBlocked(address recipient, bool blocked) external {
        blockedRecipients[recipient] = blocked;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "allowance");
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(!blockedRecipients[to], "blocked");
        require(balanceOf[from] >= amount, "balance");
        uint256 fee = (amount * feeBps) / 10_000;
        balanceOf[from] -= amount;
        balanceOf[to] += amount - fee;
        totalSupply -= fee;
        emit Transfer(from, to, amount);
    }

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);
}

contract MockPair {
    address public immutable token0;
    address public immutable token1;
    address public immutable baseToken;
    address public immutable quoteToken;
    uint112 private reserve0;
    uint112 private reserve1;
    uint32 private blockTimestampLast;

    constructor(address token0_, address token1_, address baseToken_, address quoteToken_) {
        token0 = token0_;
        token1 = token1_;
        baseToken = baseToken_;
        quoteToken = quoteToken_;
    }

    function setReserves(uint112 reserve0_, uint112 reserve1_) external {
        reserve0 = reserve0_;
        reserve1 = reserve1_;
        blockTimestampLast = uint32(block.timestamp);
    }

    function getReserves() external view returns (uint112, uint112, uint32) {
        return (reserve0, reserve1, blockTimestampLast);
    }

    function priceX18() external view returns (uint256) {
        uint256 baseReserve = token0 == baseToken ? reserve0 : reserve1;
        uint256 quoteReserve = token0 == quoteToken ? reserve0 : reserve1;
        uint8 baseDecimals = MockERC20(baseToken).decimals();
        uint8 quoteDecimals = MockERC20(quoteToken).decimals();
        uint256 normalizedBase = baseDecimals < 18
            ? baseReserve * (10 ** (18 - baseDecimals))
            : baseReserve / (10 ** (baseDecimals - 18));
        uint256 normalizedQuote = quoteDecimals < 18
            ? quoteReserve * (10 ** (18 - quoteDecimals))
            : quoteReserve / (10 ** (quoteDecimals - 18));
        if (normalizedBase == 0 || normalizedQuote == 0) return 0;
        return (normalizedQuote * 1e18) / normalizedBase;
    }
}

contract NyxBatchAuctionMathHarness is NyxBatchAuction {
    constructor(address token0_, address token1_, address referencePair_, address initialAgent)
        NyxBatchAuction(token0_, token1_, referencePair_, initialAgent, 2 days, 1_000)
    { }

    function toX18(uint256 amount, uint8 decimals_) external pure returns (uint256) {
        return _toX18(amount, decimals_);
    }

    function fromX18(uint256 amountX18, uint8 decimals_) external pure returns (uint256) {
        return _fromX18(amountX18, decimals_);
    }
}

contract NyxBatchAuctionTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    event OrderSubmitted(
        uint64 indexed batchId,
        bytes32 indexed commitment,
        address indexed trader,
        address sellToken,
        uint256 sellAmount,
        uint64 expiresAt
    );
    event OrderSettled(
        uint64 indexed batchId,
        bytes32 indexed commitment,
        address indexed trader,
        address sellToken,
        uint256 sellAmount,
        uint256 buyAmount
    );
    event OrderCancelled(
        uint64 indexed batchId,
        bytes32 indexed commitment,
        address indexed trader,
        address sellToken,
        uint256 refunded
    );
    event BatchSettled(
        uint64 indexed batchId,
        uint256 matchCount,
        uint256 clearingPriceX18,
        uint8 indexed reason,
        uint256 referencePriceX18,
        bytes32 settlementHash
    );
    event AgentUpdateStarted(address indexed oldAgent, address indexed pendingAgent);

    MockERC20 private wbot;
    MockERC20 private bousdt;
    MockPair private referencePair;
    NyxBatchAuction private auction;
    NyxBatchAuctionMathHarness private math;

    address private owner = address(0xA11CE);
    address private agent = address(0xA6E17);
    address private alice = address(0xA71CE);
    address private bob = address(0xB0B);
    address private mallory = address(0xBAD);

    uint256 private constant ONE_WBOT = 1e18;
    uint256 private constant TEN_BOUSDT = 10e6;
    uint256 private constant PRICE_10_BOUSDT_PER_WBOT_X18 = 10e18;

    function setUp() external {
        wbot = new MockERC20("Wrapped BOT", "WBOT", 18);
        bousdt = new MockERC20("BOT USD", "BOUSDT", 6);
        referencePair = new MockPair(address(bousdt), address(wbot), address(wbot), address(bousdt));
        referencePair.setReserves(1_000e6, 100e18);

        vm.prank(owner);
        auction = new NyxBatchAuction(
            address(wbot), address(bousdt), address(referencePair), agent, 2 days, 1_000
        );
        math = new NyxBatchAuctionMathHarness(
            address(wbot), address(bousdt), address(referencePair), agent
        );

        vm.startPrank(owner);
        auction.setRiskLimits(address(wbot), 3e18, 100e18, 100e18);
        auction.setRiskLimits(address(bousdt), 30e6, 1_000e6, 1_000e6);
        auction.setAllowedTrader(alice, true);
        auction.setAllowedTrader(bob, true);
        auction.unpause();
        vm.stopPrank();

        wbot.mint(alice, 3e18);
        bousdt.mint(bob, 30e6);

        vm.startPrank(alice);
        wbot.approve(address(auction), type(uint256).max);
        vm.stopPrank();

        vm.startPrank(bob);
        bousdt.approve(address(auction), type(uint256).max);
        vm.stopPrank();
    }

    function testReferencePriceNormalizesReversedDexPairDecimals() external view {
        assertEq(auction.getReferencePriceX18(), PRICE_10_BOUSDT_PER_WBOT_X18);
        assertEq(
            auction.previewBuyAmount(address(wbot), ONE_WBOT, PRICE_10_BOUSDT_PER_WBOT_X18),
            TEN_BOUSDT
        );
        assertEq(
            auction.previewBuyAmount(address(bousdt), TEN_BOUSDT, PRICE_10_BOUSDT_PER_WBOT_X18),
            ONE_WBOT
        );
    }

    function testSubmitRevealSettleHappyPathEmitsEventsAndTransfersFunds() external {
        INyxBatchAuction.OrderReveal memory aliceOrder =
            order(alice, 1, address(wbot), ONE_WBOT, TEN_BOUSDT, salt("alice"));
        INyxBatchAuction.OrderReveal memory bobOrder =
            order(bob, 1, address(bousdt), TEN_BOUSDT, ONE_WBOT, salt("bob"));
        bytes32 aliceCommitment = auction.hashOrder(aliceOrder);
        bytes32 bobCommitment = auction.hashOrder(bobOrder);

        submit(alice, aliceCommitment, address(wbot), ONE_WBOT);
        submit(bob, bobCommitment, address(bousdt), TEN_BOUSDT);

        INyxBatchAuction.MatchedOrder[] memory orders = new INyxBatchAuction.MatchedOrder[](2);
        orders[0] = INyxBatchAuction.MatchedOrder(aliceCommitment, aliceOrder);
        orders[1] = INyxBatchAuction.MatchedOrder(bobCommitment, bobOrder);

        vm.expectEmit(true, true, true, true, address(auction));
        emit OrderSettled(1, aliceCommitment, alice, address(wbot), ONE_WBOT, TEN_BOUSDT);
        vm.expectEmit(true, true, true, true, address(auction));
        emit OrderSettled(1, bobCommitment, bob, address(bousdt), TEN_BOUSDT, ONE_WBOT);
        vm.expectEmit(true, false, true, false, address(auction));
        emit BatchSettled(1, 2, PRICE_10_BOUSDT_PER_WBOT_X18, 0, 0, bytes32(0));

        vm.prank(agent);
        (uint256 matchCount, bytes32 settlementHash) =
            auction.settleBatch(1, PRICE_10_BOUSDT_PER_WBOT_X18, 0, orders);

        assertEq(matchCount, 2);
        assertTrue(settlementHash != bytes32(0));
        assertEq(uint256(auction.currentBatchId()), 2);
        assertEq(wbot.balanceOf(bob), ONE_WBOT);
        assertEq(bousdt.balanceOf(alice), TEN_BOUSDT);
        assertOrderStatus(aliceCommitment, 2);
        assertOrderStatus(bobCommitment, 2);
    }

    function testHashMismatchRejectsSettlement() external {
        INyxBatchAuction.OrderReveal memory committed =
            order(alice, 1, address(wbot), ONE_WBOT, TEN_BOUSDT, salt("alice"));
        bytes32 commitment = auction.hashOrder(committed);
        submit(alice, commitment, address(wbot), ONE_WBOT);

        INyxBatchAuction.OrderReveal memory wrongSalt =
            order(alice, 1, address(wbot), ONE_WBOT, TEN_BOUSDT, salt("wrong"));
        INyxBatchAuction.MatchedOrder[] memory orders = new INyxBatchAuction.MatchedOrder[](1);
        orders[0] = INyxBatchAuction.MatchedOrder(commitment, wrongSalt);

        vm.expectRevert(NyxBatchAuction.HashMismatch.selector);
        vm.prank(agent);
        auction.settleBatch(1, PRICE_10_BOUSDT_PER_WBOT_X18, 0, orders);
    }

    function testWrongBatchRejectsSubmitAndReveal() external {
        bytes32 commitment = salt("future");
        vm.expectRevert(NyxBatchAuction.WrongBatch.selector);
        vm.prank(alice);
        auction.submitOrder(2, commitment, address(wbot), ONE_WBOT, defaultExpiry());

        INyxBatchAuction.OrderReveal memory committed =
            order(alice, 1, address(wbot), ONE_WBOT, TEN_BOUSDT, salt("alice"));
        bytes32 goodCommitment = auction.hashOrder(committed);
        submit(alice, goodCommitment, address(wbot), ONE_WBOT);

        INyxBatchAuction.OrderReveal memory wrongBatch =
            order(alice, 2, address(wbot), ONE_WBOT, TEN_BOUSDT, salt("alice"));
        INyxBatchAuction.MatchedOrder[] memory orders = new INyxBatchAuction.MatchedOrder[](1);
        orders[0] = INyxBatchAuction.MatchedOrder(goodCommitment, wrongBatch);

        vm.expectRevert(NyxBatchAuction.WrongBatch.selector);
        vm.prank(agent);
        auction.settleBatch(1, PRICE_10_BOUSDT_PER_WBOT_X18, 0, orders);
    }

    function testCancelAfterDelayRefundsEscrowAndEmitsEvent() external {
        INyxBatchAuction.OrderReveal memory aliceOrder =
            order(alice, 1, address(wbot), ONE_WBOT, TEN_BOUSDT, salt("alice"));
        bytes32 commitment = auction.hashOrder(aliceOrder);
        submit(alice, commitment, address(wbot), ONE_WBOT);

        vm.expectRevert(NyxBatchAuction.CancelDelayNotElapsed.selector);
        vm.prank(alice);
        auction.cancelOrder(commitment);

        vm.warp(block.timestamp + 2 days + 1);
        vm.expectEmit(true, true, true, true, address(auction));
        emit OrderCancelled(1, commitment, alice, address(wbot), ONE_WBOT);

        vm.prank(alice);
        auction.cancelOrder(commitment);

        assertEq(wbot.balanceOf(alice), 3e18);
        assertOrderStatus(commitment, 3);
    }

    function testSettlementRejectsOrdersBelowMinBuyAmount() external {
        INyxBatchAuction.OrderReveal memory aliceOrder =
            order(alice, 1, address(wbot), ONE_WBOT, TEN_BOUSDT + 1, salt("alice"));
        INyxBatchAuction.OrderReveal memory bobOrder =
            order(bob, 1, address(bousdt), TEN_BOUSDT, ONE_WBOT, salt("bob"));
        bytes32 aliceCommitment = auction.hashOrder(aliceOrder);
        bytes32 bobCommitment = auction.hashOrder(bobOrder);
        submit(alice, aliceCommitment, address(wbot), ONE_WBOT);
        submit(bob, bobCommitment, address(bousdt), TEN_BOUSDT);

        INyxBatchAuction.MatchedOrder[] memory orders = new INyxBatchAuction.MatchedOrder[](2);
        orders[0] = INyxBatchAuction.MatchedOrder(aliceCommitment, aliceOrder);
        orders[1] = INyxBatchAuction.MatchedOrder(bobCommitment, bobOrder);

        vm.expectRevert(NyxBatchAuction.MinBuyAmountNotMet.selector);
        vm.prank(agent);
        auction.settleBatch(1, PRICE_10_BOUSDT_PER_WBOT_X18, 0, orders);
    }

    function testSettlementRejectsClearingPriceOutsideReferenceBand() external {
        INyxBatchAuction.OrderReveal memory aliceOrder =
            order(alice, 1, address(wbot), ONE_WBOT, 0, salt("alice"));
        INyxBatchAuction.OrderReveal memory bobOrder =
            order(bob, 1, address(bousdt), TEN_BOUSDT, 0, salt("bob"));
        bytes32 aliceCommitment = auction.hashOrder(aliceOrder);
        bytes32 bobCommitment = auction.hashOrder(bobOrder);
        submit(alice, aliceCommitment, address(wbot), ONE_WBOT);
        submit(bob, bobCommitment, address(bousdt), TEN_BOUSDT);

        INyxBatchAuction.MatchedOrder[] memory orders = new INyxBatchAuction.MatchedOrder[](2);
        orders[0] = INyxBatchAuction.MatchedOrder(aliceCommitment, aliceOrder);
        orders[1] = INyxBatchAuction.MatchedOrder(bobCommitment, bobOrder);

        vm.expectRevert(NyxBatchAuction.ClearingPriceDeviationTooHigh.selector);
        vm.prank(agent);
        auction.settleBatch(1, 12e18, 0, orders);
    }

    function testOnlyAgentCanSettleAndOnlyOwnerCanUpdateAgent() external {
        INyxBatchAuction.MatchedOrder[] memory orders = new INyxBatchAuction.MatchedOrder[](0);
        vm.expectRevert(NyxBatchAuction.OnlyAgent.selector);
        vm.prank(mallory);
        auction.settleBatch(1, PRICE_10_BOUSDT_PER_WBOT_X18, 0, orders);

        vm.expectRevert(NyxBatchAuction.OnlyOwner.selector);
        vm.prank(mallory);
        auction.setAgent(mallory);

        vm.expectEmit(true, true, false, true, address(auction));
        emit AgentUpdateStarted(agent, mallory);
        vm.prank(owner);
        auction.setAgent(mallory);
        assertEq(auction.agent(), agent);
        assertEq(auction.pendingAgent(), mallory);

        vm.expectRevert(NyxBatchAuction.OnlyPendingAgent.selector);
        vm.prank(bob);
        auction.acceptAgent();

        vm.prank(mallory);
        auction.acceptAgent();
        assertEq(auction.agent(), mallory);
        assertEq(auction.pendingAgent(), address(0));
    }

    function testSubmitRejectsFeeOnTransferAmount() external {
        bousdt.setFeeBps(100);
        INyxBatchAuction.OrderReveal memory bobOrder =
            order(bob, 1, address(bousdt), TEN_BOUSDT, ONE_WBOT, salt("fee"));
        bytes32 commitment = auction.hashOrder(bobOrder);

        vm.expectRevert(NyxBatchAuction.ReceivedAmountMismatch.selector);
        vm.prank(bob);
        auction.submitOrder(1, commitment, address(bousdt), TEN_BOUSDT, defaultExpiry());

        assertEq(bousdt.balanceOf(address(auction)), 0);
        assertOrderStatus(commitment, 0);
    }

    function testPayoutFailureBecomesClaimableAndDoesNotRevertBatch() external {
        INyxBatchAuction.OrderReveal memory aliceOrder =
            order(alice, 1, address(wbot), ONE_WBOT, TEN_BOUSDT, salt("blocked-a"));
        INyxBatchAuction.OrderReveal memory bobOrder =
            order(bob, 1, address(bousdt), TEN_BOUSDT, ONE_WBOT, salt("blocked-b"));
        bytes32 aliceCommitment = auction.hashOrder(aliceOrder);
        bytes32 bobCommitment = auction.hashOrder(bobOrder);
        submit(alice, aliceCommitment, address(wbot), ONE_WBOT);
        submit(bob, bobCommitment, address(bousdt), TEN_BOUSDT);

        bousdt.setBlocked(alice, true);
        INyxBatchAuction.MatchedOrder[] memory orders = new INyxBatchAuction.MatchedOrder[](2);
        orders[0] = INyxBatchAuction.MatchedOrder(aliceCommitment, aliceOrder);
        orders[1] = INyxBatchAuction.MatchedOrder(bobCommitment, bobOrder);

        vm.prank(agent);
        auction.settleBatch(1, PRICE_10_BOUSDT_PER_WBOT_X18, 0, orders);

        assertEq(auction.claimableBalances(address(bousdt), alice), TEN_BOUSDT);
        assertEq(bousdt.balanceOf(alice), 0);
        assertEq(wbot.balanceOf(bob), ONE_WBOT);
        assertOrderStatus(aliceCommitment, 2);
        assertOrderStatus(bobCommitment, 2);

        bousdt.setBlocked(alice, false);
        vm.prank(alice);
        auction.claimPayout(address(bousdt));
        assertEq(auction.claimableBalances(address(bousdt), alice), 0);
        assertEq(bousdt.balanceOf(alice), TEN_BOUSDT);
    }

    function testClaimPayoutWithoutBalanceReverts() external {
        vm.expectRevert(NyxBatchAuction.NoClaimableBalance.selector);
        vm.prank(alice);
        auction.claimPayout(address(bousdt));
    }

    function testConstructorRejectsDeviationAboveTwentyPercent() external {
        vm.expectRevert(NyxBatchAuction.InvalidDeviationBps.selector);
        vm.prank(owner);
        new NyxBatchAuction(
            address(wbot), address(bousdt), address(referencePair), agent, 2 days, 2_001
        );
    }

    function testConstructorRejectsInvalidAddressesTokensAndPair() external {
        vm.expectRevert(NyxBatchAuction.ZeroAddress.selector);
        vm.prank(owner);
        new NyxBatchAuction(
            address(0), address(bousdt), address(referencePair), agent, 2 days, 1_000
        );

        vm.expectRevert(NyxBatchAuction.InvalidToken.selector);
        vm.prank(owner);
        new NyxBatchAuction(
            address(wbot), address(wbot), address(referencePair), agent, 2 days, 1_000
        );

        MockPair invalidPair =
            new MockPair(address(wbot), address(wbot), address(wbot), address(wbot));
        vm.expectRevert(NyxBatchAuction.InvalidReferencePair.selector);
        vm.prank(owner);
        new NyxBatchAuction(
            address(wbot), address(bousdt), address(invalidPair), agent, 2 days, 1_000
        );
    }

    function testDirectReferencePairOrientationIsSupported() external {
        MockPair directPair =
            new MockPair(address(wbot), address(bousdt), address(wbot), address(bousdt));
        directPair.setReserves(100e18, 1_000e6);
        vm.prank(owner);
        NyxBatchAuction directAuction = new NyxBatchAuction(
            address(wbot), address(bousdt), address(directPair), agent, 2 days, 1_000
        );
        assertEq(directAuction.getReferencePriceX18(), PRICE_10_BOUSDT_PER_WBOT_X18);
    }

    function testSubmitRejectsInvalidTokenZeroAmountAndDuplicate() external {
        bytes32 commitment = salt("guards");
        vm.expectRevert(NyxBatchAuction.InvalidToken.selector);
        vm.prank(alice);
        auction.submitOrder(1, commitment, address(0xCAFE), ONE_WBOT, defaultExpiry());

        vm.expectRevert(NyxBatchAuction.ZeroAmount.selector);
        vm.prank(alice);
        auction.submitOrder(1, commitment, address(wbot), 0, defaultExpiry());

        submit(alice, commitment, address(wbot), ONE_WBOT);
        vm.expectRevert(NyxBatchAuction.DuplicateCommitment.selector);
        vm.prank(alice);
        auction.submitOrder(1, commitment, address(wbot), ONE_WBOT, defaultExpiry());
    }

    function testSettlementGuardReverts() external {
        INyxBatchAuction.MatchedOrder[] memory empty = new INyxBatchAuction.MatchedOrder[](0);
        INyxBatchAuction.MatchedOrder[] memory one = new INyxBatchAuction.MatchedOrder[](1);

        vm.expectRevert(NyxBatchAuction.WrongBatch.selector);
        vm.prank(agent);
        auction.settleBatch(2, PRICE_10_BOUSDT_PER_WBOT_X18, 0, one);

        vm.expectRevert(NyxBatchAuction.EmptySettlement.selector);
        vm.prank(agent);
        auction.settleBatch(1, PRICE_10_BOUSDT_PER_WBOT_X18, 0, empty);

        vm.expectRevert(NyxBatchAuction.ZeroAmount.selector);
        vm.prank(agent);
        auction.settleBatch(1, 0, 0, one);

        vm.expectRevert(NyxBatchAuction.InvalidReason.selector);
        vm.prank(agent);
        auction.settleBatch(1, PRICE_10_BOUSDT_PER_WBOT_X18, 5, one);
    }

    function testSettlementRejectsUnbalancedUnknownAndRevealMismatch() external {
        INyxBatchAuction.OrderReveal memory aliceOrder =
            order(alice, 1, address(wbot), ONE_WBOT, 0, salt("unbalanced"));
        bytes32 aliceCommitment = auction.hashOrder(aliceOrder);
        submit(alice, aliceCommitment, address(wbot), ONE_WBOT);
        INyxBatchAuction.MatchedOrder[] memory one = new INyxBatchAuction.MatchedOrder[](1);
        one[0] = INyxBatchAuction.MatchedOrder(aliceCommitment, aliceOrder);

        vm.expectRevert(NyxBatchAuction.UnbalancedSettlement.selector);
        vm.prank(agent);
        auction.settleBatch(1, PRICE_10_BOUSDT_PER_WBOT_X18, 0, one);

        INyxBatchAuction.OrderReveal memory unknownOrder =
            order(alice, 1, address(wbot), ONE_WBOT, 0, salt("unknown"));
        bytes32 unknownCommitment = auction.hashOrder(unknownOrder);
        one[0] = INyxBatchAuction.MatchedOrder(unknownCommitment, unknownOrder);
        vm.expectRevert(NyxBatchAuction.UnknownOrder.selector);
        vm.prank(agent);
        auction.settleBatch(1, PRICE_10_BOUSDT_PER_WBOT_X18, 0, one);

        INyxBatchAuction.OrderReveal memory committed =
            order(alice, 1, address(wbot), ONE_WBOT, 0, salt("mismatch"));
        bytes32 commitment = auction.hashOrder(committed);
        submit(alice, commitment, address(wbot), 2 * ONE_WBOT);
        one[0] = INyxBatchAuction.MatchedOrder(commitment, committed);
        vm.expectRevert(NyxBatchAuction.RevealMismatch.selector);
        vm.prank(agent);
        auction.settleBatch(1, PRICE_10_BOUSDT_PER_WBOT_X18, 0, one);
    }

    function testCancelRejectsUnknownUnauthorizedSpentAndTransferFailure() external {
        bytes32 unknown = salt("cancel-unknown");
        vm.expectRevert(NyxBatchAuction.UnknownOrder.selector);
        vm.prank(alice);
        auction.cancelOrder(unknown);

        INyxBatchAuction.OrderReveal memory aliceOrder =
            order(alice, 1, address(wbot), ONE_WBOT, 0, salt("cancel"));
        bytes32 commitment = auction.hashOrder(aliceOrder);
        submit(alice, commitment, address(wbot), ONE_WBOT);

        vm.expectRevert(NyxBatchAuction.UnauthorizedTrader.selector);
        vm.prank(bob);
        auction.cancelOrder(commitment);

        vm.warp(block.timestamp + 2 days + 1);
        vm.prank(alice);
        auction.cancelOrder(commitment);
        vm.expectRevert(NyxBatchAuction.OrderNotSubmitted.selector);
        vm.prank(alice);
        auction.cancelOrder(commitment);

        INyxBatchAuction.OrderReveal memory blockedOrder =
            order(alice, 1, address(wbot), ONE_WBOT, 0, salt("cancel-blocked"));
        bytes32 blockedCommitment = auction.hashOrder(blockedOrder);
        submit(alice, blockedCommitment, address(wbot), ONE_WBOT);
        wbot.setBlocked(alice, true);
        vm.warp(block.timestamp + 3 days);
        vm.expectRevert(NyxBatchAuction.SafeTransferFailed.selector);
        vm.prank(alice);
        auction.cancelOrder(blockedCommitment);
        assertOrderStatus(blockedCommitment, 1);
    }

    function testTransferFromFailureAndViewGuards() external {
        bousdt.setBlocked(address(auction), true);
        vm.expectRevert(NyxBatchAuction.SafeTransferFailed.selector);
        vm.prank(bob);
        auction.submitOrder(
            1, salt("transfer-failure"), address(bousdt), TEN_BOUSDT, defaultExpiry()
        );

        vm.expectRevert(NyxBatchAuction.ZeroAmount.selector);
        auction.previewBuyAmount(address(wbot), ONE_WBOT, 0);
        vm.expectRevert(NyxBatchAuction.InvalidToken.selector);
        auction.previewBuyAmount(address(0xCAFE), ONE_WBOT, PRICE_10_BOUSDT_PER_WBOT_X18);

        referencePair.setReserves(0, 100e18);
        vm.expectRevert(NyxBatchAuction.ZeroReferenceReserve.selector);
        auction.getReferencePriceX18();
    }

    function testSetAgentRejectsZeroAddress() external {
        vm.expectRevert(NyxBatchAuction.ZeroAddress.selector);
        vm.prank(owner);
        auction.setAgent(address(0));
    }

    function testFuzzPreviewAndScaling(
        uint256 amount,
        uint8 sellDecimals,
        uint8 buyDecimals,
        uint256 price
    ) external view {
        sellDecimals = uint8(uint256(sellDecimals) % 25);
        buyDecimals = uint8(uint256(buyDecimals) % 25);
        amount = amount % 1e18;
        price = (price % 1e24) + 1;

        uint256 normalized = math.toX18(amount, sellDecimals);
        assertTrue(math.fromX18(normalized, sellDecimals) <= amount);
        uint256 restored = math.fromX18(price, buyDecimals);
        assertTrue(math.toX18(restored, buyDecimals) <= price);

        uint256 wbotAmount = amount % 1e12;
        uint256 expectedBousdt = math.fromX18((math.toX18(wbotAmount, 18) * price) / 1e18, 6);
        assertEq(auction.previewBuyAmount(address(wbot), wbotAmount, price), expectedBousdt);

        uint256 bousdtAmount = amount % 1e6;
        uint256 expectedWbot = math.fromX18((math.toX18(bousdtAmount, 6) * 1e18) / price, 18);
        assertEq(auction.previewBuyAmount(address(bousdt), bousdtAmount, price), expectedWbot);
    }

    /// A commitment repeated inside one settlement used to be paid twice: every entry was
    /// validated while all orders were still SUBMITTED, aggregate conservation still
    /// balanced, and the second payout came out of another trader's escrow. Statuses are
    /// now written during validation, so the repeat is rejected.
    function testRepeatedCommitmentInSettlementReverts() external {
        INyxBatchAuction.OrderReveal memory a =
            order(alice, 1, address(wbot), ONE_WBOT, TEN_BOUSDT, salt("a1"));
        INyxBatchAuction.OrderReveal memory b =
            order(bob, 1, address(bousdt), TEN_BOUSDT, ONE_WBOT, salt("b1"));
        INyxBatchAuction.OrderReveal memory c =
            order(alice, 1, address(wbot), ONE_WBOT, TEN_BOUSDT, salt("a2"));
        INyxBatchAuction.OrderReveal memory d =
            order(bob, 1, address(bousdt), TEN_BOUSDT, ONE_WBOT, salt("b2"));

        bytes32 ca = auction.hashOrder(a);
        bytes32 cb = auction.hashOrder(b);
        bytes32 cc = auction.hashOrder(c);
        bytes32 cd = auction.hashOrder(d);

        submit(alice, ca, address(wbot), ONE_WBOT);
        submit(bob, cb, address(bousdt), TEN_BOUSDT);
        submit(alice, cc, address(wbot), ONE_WBOT);
        submit(bob, cd, address(bousdt), TEN_BOUSDT);

        assertEq(wbot.balanceOf(address(auction)), 2 * ONE_WBOT);
        assertEq(bousdt.balanceOf(address(auction)), 2 * TEN_BOUSDT);

        // The agent settles the same two commitments twice and omits the other pair.
        INyxBatchAuction.MatchedOrder[] memory orders = new INyxBatchAuction.MatchedOrder[](4);
        orders[0] = INyxBatchAuction.MatchedOrder(ca, a);
        orders[1] = INyxBatchAuction.MatchedOrder(cb, b);
        orders[2] = INyxBatchAuction.MatchedOrder(ca, a);
        orders[3] = INyxBatchAuction.MatchedOrder(cb, b);

        vm.expectRevert(NyxBatchAuction.OrderNotSubmitted.selector);
        vm.prank(agent);
        auction.settleBatch(1, PRICE_10_BOUSDT_PER_WBOT_X18, 0, orders);

        // Nobody was paid and every escrow balance is intact.
        assertEq(bousdt.balanceOf(alice), 0);
        assertEq(wbot.balanceOf(bob), 0);
        assertEq(wbot.balanceOf(address(auction)), 2 * ONE_WBOT);
        assertEq(bousdt.balanceOf(address(auction)), 2 * TEN_BOUSDT);
        assertOrderStatus(cc, 1);
        assertOrderStatus(cd, 1);

        // The cancel-refund guarantee still holds.
        vm.warp(block.timestamp + 3 days);
        vm.prank(alice);
        auction.cancelOrder(cc);
        assertEq(wbot.balanceOf(alice), 2e18);
    }

    function submit(address trader, bytes32 commitment, address sellToken, uint256 sellAmount)
        internal
    {
        vm.expectEmit(true, true, true, true, address(auction));
        emit OrderSubmitted(1, commitment, trader, sellToken, sellAmount, defaultExpiry());
        vm.prank(trader);
        auction.submitOrder(1, commitment, sellToken, sellAmount, defaultExpiry());
    }

    function order(
        address trader,
        uint64 batchId,
        address sellToken,
        uint256 sellAmount,
        uint256 minBuyAmount,
        bytes32 salt_
    ) internal view returns (INyxBatchAuction.OrderReveal memory) {
        return INyxBatchAuction.OrderReveal({
            trader: trader,
            batchId: batchId,
            sellToken: sellToken,
            sellAmount: sellAmount,
            minBuyAmount: minBuyAmount,
            expiresAt: defaultExpiry(),
            salt: salt_
        });
    }

    function assertOrderStatus(bytes32 commitment, uint8 expectedStatus) internal view {
        (,,,,,, uint8 status) = auction.getOrder(commitment);
        assertEq(status, expectedStatus);
    }

    function defaultExpiry() internal view returns (uint64) {
        return uint64(block.timestamp + 2 days);
    }

    function salt(string memory value) internal pure returns (bytes32) {
        return keccak256(bytes(value));
    }

    function assertEq(uint256 actual, uint256 expected) internal pure {
        require(actual == expected, "uint256 neq");
    }

    function assertEq(address actual, address expected) internal pure {
        require(actual == expected, "address neq");
    }

    function assertTrue(bool condition) internal pure {
        require(condition, "not true");
    }
}
