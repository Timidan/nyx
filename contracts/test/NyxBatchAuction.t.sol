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

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

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
        require(balanceOf[from] >= amount, "balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);
}

contract MockPair {
    address public immutable token0;
    address public immutable token1;
    uint112 private reserve0;
    uint112 private reserve1;
    uint32 private blockTimestampLast;

    constructor(address token0_, address token1_) {
        token0 = token0_;
        token1 = token1_;
    }

    function setReserves(uint112 reserve0_, uint112 reserve1_) external {
        reserve0 = reserve0_;
        reserve1 = reserve1_;
        blockTimestampLast = uint32(block.timestamp);
    }

    function getReserves() external view returns (uint112, uint112, uint32) {
        return (reserve0, reserve1, blockTimestampLast);
    }
}

contract NyxBatchAuctionTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    event OrderSubmitted(
        uint64 indexed batchId,
        bytes32 indexed commitment,
        address indexed trader,
        address sellToken,
        uint256 sellAmount
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
        referencePair = new MockPair(address(bousdt), address(wbot));
        referencePair.setReserves(1_000e6, 100e18);

        vm.prank(owner);
        auction = new NyxBatchAuction(
            address(wbot), address(bousdt), address(referencePair), agent, 2 days, 1_000
        );

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
        auction.submitOrder(2, commitment, address(wbot), ONE_WBOT);

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

    function submit(address trader, bytes32 commitment, address sellToken, uint256 sellAmount)
        internal
    {
        vm.expectEmit(true, true, true, true, address(auction));
        emit OrderSubmitted(1, commitment, trader, sellToken, sellAmount);
        vm.prank(trader);
        auction.submitOrder(1, commitment, sellToken, sellAmount);
    }

    function order(
        address trader,
        uint64 batchId,
        address sellToken,
        uint256 sellAmount,
        uint256 minBuyAmount,
        bytes32 salt_
    ) internal pure returns (INyxBatchAuction.OrderReveal memory) {
        return INyxBatchAuction.OrderReveal({
            trader: trader,
            batchId: batchId,
            sellToken: sellToken,
            sellAmount: sellAmount,
            minBuyAmount: minBuyAmount,
            salt: salt_
        });
    }

    function assertOrderStatus(bytes32 commitment, uint8 expectedStatus) internal view {
        (,,,,, uint8 status) = auction.getOrder(commitment);
        assertEq(status, expectedStatus);
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
