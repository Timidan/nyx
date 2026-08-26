// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { NyxBatchAuction } from "../src/NyxBatchAuction.sol";
import { INyxBatchAuction } from "../src/interfaces/INyxBatchAuction.sol";

interface InvariantVm {
    function warp(uint256 newTimestamp) external;
    function prank(address msgSender) external;
}

abstract contract StdInvariant {
    struct FuzzSelector {
        address addr;
        bytes4[] selectors;
    }

    struct FuzzArtifactSelector {
        string artifact;
        bytes4[] selectors;
    }

    struct FuzzInterface {
        address addr;
        string[] artifacts;
    }

    address[] private targetedContracts;
    FuzzSelector[] private targetedSelectors;

    function targetContract(address target) internal {
        targetedContracts.push(target);
    }

    function targetSelector(FuzzSelector memory selector) internal {
        targetedSelectors.push(selector);
    }

    function targetContracts() public view returns (address[] memory) {
        return targetedContracts;
    }

    function targetSelectors() public view returns (FuzzSelector[] memory) {
        return targetedSelectors;
    }

    function excludeArtifacts() public pure returns (string[] memory) {
        return new string[](0);
    }

    function excludeContracts() public pure returns (address[] memory) {
        return new address[](0);
    }

    function excludeSelectors() public pure returns (FuzzSelector[] memory) {
        return new FuzzSelector[](0);
    }

    function excludeSenders() public pure returns (address[] memory) {
        return new address[](0);
    }

    function targetArtifacts() public pure returns (string[] memory) {
        return new string[](0);
    }

    function targetArtifactSelectors() public pure returns (FuzzArtifactSelector[] memory) {
        return new FuzzArtifactSelector[](0);
    }

    function targetSenders() public pure returns (address[] memory) {
        return new address[](0);
    }

    function targetInterfaces() public pure returns (FuzzInterface[] memory) {
        return new FuzzInterface[](0);
    }
}

contract InvariantToken {
    uint8 public immutable decimals;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool) public blocked;

    constructor(uint8 decimals_) {
        decimals = decimals_;
    }

    function setBlocked(address account, bool value) external {
        blocked[account] = value;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        return _transfer(msg.sender, to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "allowance");
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        return _transfer(from, to, amount);
    }

    function _transfer(address from, address to, uint256 amount) internal returns (bool) {
        // Mirrors a USDT-style blocklist: the token reverts rather than returning false,
        // which is the branch _trySafeTransfer catches via the low-level call result.
        require(!blocked[to], "blocked");
        require(balanceOf[from] >= amount, "balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract InvariantPair {
    address public immutable token0;
    address public immutable token1;
    address public immutable baseToken;
    address public immutable quoteToken;
    uint112 private immutable reserve0;
    uint112 private immutable reserve1;

    constructor(
        address token0_,
        address token1_,
        address baseToken_,
        address quoteToken_,
        uint112 reserve0_,
        uint112 reserve1_
    ) {
        token0 = token0_;
        token1 = token1_;
        baseToken = baseToken_;
        quoteToken = quoteToken_;
        reserve0 = reserve0_;
        reserve1 = reserve1_;
    }

    function getReserves() external view returns (uint112, uint112, uint32) {
        return (reserve0, reserve1, 0);
    }

    function priceX18() external pure returns (uint256) {
        return 10e18;
    }
}

contract NyxBatchAuctionHandler {
    InvariantVm private constant vm =
        InvariantVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 private constant ONE_WBOT = 1e18;
    uint256 private constant TEN_BOUSDT = 10e6;
    uint256 private constant PRICE_X18 = 10e18;

    struct TrackedOrder {
        bytes32 commitment;
        INyxBatchAuction.OrderReveal reveal;
        uint8 expectedStatus;
    }

    NyxBatchAuction public immutable auction;
    InvariantToken private immutable wbot;
    InvariantToken private immutable bousdt;
    TrackedOrder[] private trackedOrders;
    uint256 private nonce;
    address private constant WBOT_TRADER = address(0x1001);
    address private constant BOUSDT_TRADER = address(0x1002);

    constructor(InvariantToken wbot_, InvariantToken bousdt_, InvariantPair referencePair) {
        wbot = wbot_;
        bousdt = bousdt_;
        auction = new NyxBatchAuction(
            address(wbot_), address(bousdt_), address(referencePair), address(this), 2 days, 1_000
        );
        auction.setRiskLimits(address(wbot_), ONE_WBOT, 64 * ONE_WBOT, 64 * ONE_WBOT);
        auction.setRiskLimits(address(bousdt_), TEN_BOUSDT, 64 * TEN_BOUSDT, 64 * TEN_BOUSDT);
        auction.setAllowedTrader(WBOT_TRADER, true);
        auction.setAllowedTrader(BOUSDT_TRADER, true);
        auction.unpause();
        vm.prank(WBOT_TRADER);
        wbot_.approve(address(auction), type(uint256).max);
        vm.prank(BOUSDT_TRADER);
        bousdt_.approve(address(auction), type(uint256).max);
    }

    function submit(uint256 seed) external {
        if (trackedOrders.length >= 64) return;

        bool sellsWbot = seed % 2 == 0;
        uint64 batchId = auction.currentBatchId();
        address sellToken = sellsWbot ? address(wbot) : address(bousdt);
        uint256 sellAmount = sellsWbot ? ONE_WBOT : TEN_BOUSDT;
        address trader = sellsWbot ? WBOT_TRADER : BOUSDT_TRADER;
        INyxBatchAuction.OrderReveal memory reveal = INyxBatchAuction.OrderReveal({
            trader: trader,
            batchId: batchId,
            sellToken: sellToken,
            sellAmount: sellAmount,
            minBuyAmount: 0,
            expiresAt: uint64(block.timestamp + 2 days),
            salt: bytes32(nonce++)
        });
        bytes32 commitment = auction.hashOrder(reveal);

        if (sellsWbot) {
            wbot.mint(trader, sellAmount);
        } else {
            bousdt.mint(trader, sellAmount);
        }
        vm.prank(trader);
        auction.submitOrder(batchId, commitment, sellToken, sellAmount, reveal.expiresAt);
        trackedOrders.push(TrackedOrder(commitment, reveal, 1));
    }

    function cancel(uint256 seed) external {
        uint256 count = trackedOrders.length;
        if (count == 0) return;

        uint256 start = seed % count;
        for (uint256 offset = 0; offset < count; offset++) {
            uint256 index = (start + offset) % count;
            if (trackedOrders[index].expectedStatus != 1) continue;
            // A blocked trader cannot be refunded; skip rather than revert the run.
            address trader = trackedOrders[index].reveal.trader;
            if (InvariantToken(trackedOrders[index].reveal.sellToken).blocked(trader)) {
                continue;
            }

            vm.warp(block.timestamp + 2 days + 1);
            vm.prank(trader);
            auction.cancelOrder(trackedOrders[index].commitment);
            trackedOrders[index].expectedStatus = 3;
            return;
        }
    }

    function settlePair() external {
        uint256 count = trackedOrders.length;
        uint64 batchId = auction.currentBatchId();
        for (uint256 i = 0; i < count; i++) {
            TrackedOrder storage first = trackedOrders[i];
            if (first.expectedStatus != 1 || first.reveal.batchId != batchId) continue;
            // forge-lint: disable-next-line(block-timestamp)
            if (block.timestamp >= first.reveal.expiresAt) continue;

            for (uint256 j = i + 1; j < count; j++) {
                TrackedOrder storage second = trackedOrders[j];
                if (second.expectedStatus != 1 || second.reveal.batchId != batchId) continue;
                // forge-lint: disable-next-line(block-timestamp)
                if (block.timestamp >= second.reveal.expiresAt) continue;
                if (first.reveal.sellToken == second.reveal.sellToken) continue;

                INyxBatchAuction.MatchedOrder[] memory orders =
                    new INyxBatchAuction.MatchedOrder[](2);
                orders[0] = INyxBatchAuction.MatchedOrder(first.commitment, first.reveal);
                orders[1] = INyxBatchAuction.MatchedOrder(second.commitment, second.reveal);
                auction.settleBatch(batchId, PRICE_X18, 0, orders);
                first.expectedStatus = 2;
                second.expectedStatus = 2;
                return;
            }
        }
    }

    function advanceTime(uint256 seconds_) external {
        vm.warp(block.timestamp + (seconds_ % 3 days));
    }

    /// Flips the blocklist so settlement payouts fall back to claimableBalances,
    /// which is the only way the campaign reaches the deferred-payout branch.
    function toggleBlock(uint256 seed) external {
        InvariantToken token = seed % 2 == 0 ? wbot : bousdt;
        address trader = seed % 4 < 2 ? WBOT_TRADER : BOUSDT_TRADER;
        token.setBlocked(trader, !token.blocked(trader));
    }

    function claim(uint256 seed) external {
        InvariantToken token = seed % 2 == 0 ? wbot : bousdt;
        address trader = seed % 4 < 2 ? WBOT_TRADER : BOUSDT_TRADER;
        if (auction.claimableBalances(address(token), trader) == 0) return;
        if (token.blocked(trader)) return;
        vm.prank(trader);
        auction.claimPayout(address(token));
    }

    function trackedOrderCount() external view returns (uint256) {
        return trackedOrders.length;
    }

    function trackedOrder(uint256 index)
        external
        view
        returns (bytes32 commitment, address sellToken, uint256 sellAmount, uint8 expectedStatus)
    {
        TrackedOrder storage tracked = trackedOrders[index];
        return (
            tracked.commitment,
            tracked.reveal.sellToken,
            tracked.reveal.sellAmount,
            tracked.expectedStatus
        );
    }
}

contract NyxBatchAuctionInvariantTest is StdInvariant {
    InvariantToken private wbot;
    InvariantToken private bousdt;
    NyxBatchAuctionHandler private handler;
    NyxBatchAuction private auction;

    function setUp() external {
        wbot = new InvariantToken(18);
        bousdt = new InvariantToken(6);
        InvariantPair referencePair = new InvariantPair(
            address(bousdt), address(wbot), address(wbot), address(bousdt), 1_000e6, 100e18
        );
        handler = new NyxBatchAuctionHandler(wbot, bousdt, referencePair);
        auction = handler.auction();
        bytes4[] memory selectors = new bytes4[](6);
        selectors[0] = NyxBatchAuctionHandler.submit.selector;
        selectors[1] = NyxBatchAuctionHandler.cancel.selector;
        selectors[2] = NyxBatchAuctionHandler.settlePair.selector;
        selectors[3] = NyxBatchAuctionHandler.advanceTime.selector;
        selectors[4] = NyxBatchAuctionHandler.toggleBlock.selector;
        selectors[5] = NyxBatchAuctionHandler.claim.selector;
        targetContract(address(handler));
        targetSelector(FuzzSelector(address(handler), selectors));
    }

    function invariant_exactTokenConservation() external view {
        uint256 submittedWbot;
        uint256 submittedBousdt;
        uint256 count = handler.trackedOrderCount();
        for (uint256 i = 0; i < count; i++) {
            (bytes32 commitment, address sellToken, uint256 sellAmount, uint8 expectedStatus) =
                handler.trackedOrder(i);
            (,,,,,, uint8 status) = auction.getOrder(commitment);
            require(status == expectedStatus, "status diverged");
            if (status != 1) continue;
            if (sellToken == address(wbot)) {
                submittedWbot += sellAmount;
            } else {
                submittedBousdt += sellAmount;
            }
        }
        // Deferred payouts are a second claim on the same pooled balance, so the
        // solvency floor is escrow + claimables, not escrow alone.
        submittedWbot += auction.claimableBalances(address(wbot), address(0x1001));
        submittedWbot += auction.claimableBalances(address(wbot), address(0x1002));
        submittedBousdt += auction.claimableBalances(address(bousdt), address(0x1001));
        submittedBousdt += auction.claimableBalances(address(bousdt), address(0x1002));

        require(wbot.balanceOf(address(auction)) >= submittedWbot, "WBOT escrow deficit");
        require(bousdt.balanceOf(address(auction)) >= submittedBousdt, "BOUSDT escrow deficit");
    }

    function invariant_orderStatusOnlyMovesForward() external view {
        uint256 count = handler.trackedOrderCount();
        for (uint256 i = 0; i < count; i++) {
            (bytes32 commitment,,, uint8 expectedStatus) = handler.trackedOrder(i);
            (,,,,,, uint8 status) = auction.getOrder(commitment);
            require(status == expectedStatus, "order status moved unexpectedly");
            require(status == 1 || status == 2 || status == 3, "invalid order status");
        }
    }
}
