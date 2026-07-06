// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { INyxBatchAuction } from "./interfaces/INyxBatchAuction.sol";

interface IERC20Minimal {
    function decimals() external view returns (uint8);
}

interface IUniswapV2PairLike {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32);
}

contract NyxBatchAuction is INyxBatchAuction {
    uint8 private constant STATUS_NONE = 0;
    uint8 private constant STATUS_SUBMITTED = 1;
    uint8 private constant STATUS_SETTLED = 2;
    uint8 private constant STATUS_CANCELLED = 3;
    uint8 private constant MAX_REASON = 4;
    uint256 private constant X18 = 1e18;

    address public immutable token0;
    address public immutable token1;
    address public immutable referencePair;
    address public immutable owner;
    uint256 public immutable cancelDelaySeconds;

    address public agent;
    uint64 public currentBatchId;

    uint8 private immutable token0Decimals;
    uint8 private immutable token1Decimals;

    bool private locked;

    struct StoredOrder {
        address trader;
        uint64 batchId;
        address sellToken;
        uint256 sellAmount;
        uint64 submittedAt;
        uint8 status;
    }

    mapping(bytes32 => StoredOrder) private ordersByCommitment;

    error OnlyAgent();
    error OnlyOwner();
    error ReentrantCall();
    error ZeroAddress();
    error ZeroAmount();
    error InvalidToken();
    error InvalidReason();
    error InvalidReferencePair();
    error EmptySettlement();
    error WrongBatch();
    error DuplicateCommitment();
    error UnknownOrder();
    error UnauthorizedTrader();
    error OrderNotSubmitted();
    error HashMismatch();
    error RevealMismatch();
    error MinBuyAmountNotMet();
    error UnbalancedSettlement();
    error CancelDelayNotElapsed();
    error SafeTransferFailed();
    error ZeroReferenceReserve();

    modifier onlyAgent() {
        if (msg.sender != agent) revert OnlyAgent();
        _;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    modifier nonReentrant() {
        if (locked) revert ReentrantCall();
        locked = true;
        _;
        locked = false;
    }

    constructor(
        address token0_,
        address token1_,
        address referencePair_,
        address initialAgent,
        uint256 cancelDelaySeconds_
    ) {
        if (
            token0_ == address(0) || token1_ == address(0) || referencePair_ == address(0)
                || initialAgent == address(0)
        ) revert ZeroAddress();
        if (token0_ == token1_) revert InvalidToken();

        token0 = token0_;
        token1 = token1_;
        referencePair = referencePair_;
        owner = msg.sender;
        agent = initialAgent;
        cancelDelaySeconds = cancelDelaySeconds_;
        token0Decimals = IERC20Minimal(token0_).decimals();
        token1Decimals = IERC20Minimal(token1_).decimals();

        _validateReferencePair();

        currentBatchId = 1;
        emit AgentUpdated(address(0), initialAgent);
        emit BatchOpened(1, uint64(block.timestamp));
    }

    function submitOrder(uint64 batchId, bytes32 commitment, address sellToken, uint256 sellAmount)
        external
        nonReentrant
    {
        if (batchId != currentBatchId) revert WrongBatch();
        if (!_isAuctionToken(sellToken)) revert InvalidToken();
        if (sellAmount == 0) revert ZeroAmount();
        if (ordersByCommitment[commitment].status != STATUS_NONE) revert DuplicateCommitment();

        ordersByCommitment[commitment] = StoredOrder({
            trader: msg.sender,
            batchId: batchId,
            sellToken: sellToken,
            sellAmount: sellAmount,
            submittedAt: uint64(block.timestamp),
            status: STATUS_SUBMITTED
        });

        _safeTransferFrom(sellToken, msg.sender, address(this), sellAmount);
        emit OrderSubmitted(batchId, commitment, msg.sender, sellToken, sellAmount);
    }

    function settleBatch(
        uint64 batchId,
        uint256 clearingPriceX18,
        uint8 reason,
        MatchedOrder[] calldata matchedOrders
    ) external onlyAgent nonReentrant returns (uint256 matchCount, bytes32 settlementHash) {
        if (batchId != currentBatchId) revert WrongBatch();
        if (matchedOrders.length == 0) revert EmptySettlement();
        if (clearingPriceX18 == 0) revert ZeroAmount();
        if (reason > MAX_REASON) revert InvalidReason();

        SettlementTotals memory totals;
        bytes32[] memory commitments = new bytes32[](matchedOrders.length);
        uint256[] memory buyAmounts = new uint256[](matchedOrders.length);

        for (uint256 i = 0; i < matchedOrders.length; i++) {
            bytes32 commitment = matchedOrders[i].commitment;
            OrderReveal calldata reveal = matchedOrders[i].order;
            uint256 buyAmount = _validateMatchedOrder(batchId, commitment, reveal, clearingPriceX18);
            commitments[i] = commitment;
            buyAmounts[i] = buyAmount;
            _accumulateTotals(totals, reveal.sellToken, reveal.sellAmount, buyAmount);
        }

        if (totals.sold0 != totals.buy0 || totals.sold1 != totals.buy1) {
            revert UnbalancedSettlement();
        }

        for (uint256 i = 0; i < matchedOrders.length; i++) {
            bytes32 commitment = matchedOrders[i].commitment;
            OrderReveal calldata reveal = matchedOrders[i].order;
            uint256 buyAmount = buyAmounts[i];
            ordersByCommitment[commitment].status = STATUS_SETTLED;
            address buyToken = reveal.sellToken == token0 ? token1 : token0;
            _safeTransfer(buyToken, reveal.trader, buyAmount);
            emit OrderSettled(
                batchId, commitment, reveal.trader, reveal.sellToken, reveal.sellAmount, buyAmount
            );
        }

        matchCount = matchedOrders.length;
        settlementHash = keccak256(
            abi.encode(block.chainid, address(this), batchId, clearingPriceX18, reason, commitments)
        );
        uint256 referencePriceX18 = getReferencePriceX18();
        emit BatchSettled(
            batchId, matchCount, clearingPriceX18, reason, referencePriceX18, settlementHash
        );

        unchecked {
            currentBatchId = batchId + 1;
        }
        emit BatchOpened(currentBatchId, uint64(block.timestamp));
    }

    function cancelOrder(bytes32 commitment) external nonReentrant {
        StoredOrder storage stored = ordersByCommitment[commitment];
        if (stored.status == STATUS_NONE) revert UnknownOrder();
        if (stored.status != STATUS_SUBMITTED) revert OrderNotSubmitted();
        if (stored.trader != msg.sender) revert UnauthorizedTrader();
        if (block.timestamp < uint256(stored.submittedAt) + cancelDelaySeconds) {
            revert CancelDelayNotElapsed();
        }

        stored.status = STATUS_CANCELLED;
        _safeTransfer(stored.sellToken, stored.trader, stored.sellAmount);
        emit OrderCancelled(
            stored.batchId, commitment, stored.trader, stored.sellToken, stored.sellAmount
        );
    }

    function hashOrder(OrderReveal calldata order) external view returns (bytes32) {
        return _hashOrder(order);
    }

    function getReferencePriceX18() public view returns (uint256 priceX18) {
        (uint112 reserve0, uint112 reserve1,) = IUniswapV2PairLike(referencePair).getReserves();
        (uint256 auctionToken0Reserve, uint256 auctionToken1Reserve) =
            _referenceReservesForAuctionTokens(reserve0, reserve1);

        uint256 token0ReserveX18 = _toX18(auctionToken0Reserve, token0Decimals);
        uint256 token1ReserveX18 = _toX18(auctionToken1Reserve, token1Decimals);
        if (token0ReserveX18 == 0 || token1ReserveX18 == 0) revert ZeroReferenceReserve();

        return (token1ReserveX18 * X18) / token0ReserveX18;
    }

    function previewBuyAmount(address sellToken, uint256 sellAmount, uint256 clearingPriceX18)
        public
        view
        returns (uint256 buyAmount)
    {
        if (clearingPriceX18 == 0) revert ZeroAmount();
        if (sellToken == token0) {
            uint256 sellX18 = _toX18(sellAmount, token0Decimals);
            return _fromX18((sellX18 * clearingPriceX18) / X18, token1Decimals);
        }
        if (sellToken == token1) {
            uint256 sellX18 = _toX18(sellAmount, token1Decimals);
            return _fromX18((sellX18 * X18) / clearingPriceX18, token0Decimals);
        }
        revert InvalidToken();
    }

    function getOrder(bytes32 commitment)
        external
        view
        returns (
            address trader,
            uint64 batchId,
            address sellToken,
            uint256 sellAmount,
            uint64 submittedAt,
            uint8 status
        )
    {
        StoredOrder storage stored = ordersByCommitment[commitment];
        return (
            stored.trader,
            stored.batchId,
            stored.sellToken,
            stored.sellAmount,
            stored.submittedAt,
            stored.status
        );
    }

    function setAgent(address newAgent) external onlyOwner {
        if (newAgent == address(0)) revert ZeroAddress();
        address oldAgent = agent;
        agent = newAgent;
        emit AgentUpdated(oldAgent, newAgent);
    }

    struct SettlementTotals {
        uint256 sold0;
        uint256 sold1;
        uint256 buy0;
        uint256 buy1;
    }

    function _validateMatchedOrder(
        uint64 batchId,
        bytes32 commitment,
        OrderReveal calldata reveal,
        uint256 clearingPriceX18
    ) internal view returns (uint256 buyAmount) {
        if (reveal.batchId != batchId) revert WrongBatch();
        if (_hashOrder(reveal) != commitment) revert HashMismatch();

        StoredOrder storage stored = ordersByCommitment[commitment];
        if (stored.status == STATUS_NONE) revert UnknownOrder();
        if (stored.status != STATUS_SUBMITTED) revert OrderNotSubmitted();
        if (
            stored.trader != reveal.trader || stored.batchId != reveal.batchId
                || stored.sellToken != reveal.sellToken || stored.sellAmount != reveal.sellAmount
        ) revert RevealMismatch();

        buyAmount = previewBuyAmount(reveal.sellToken, reveal.sellAmount, clearingPriceX18);
        if (buyAmount < reveal.minBuyAmount) revert MinBuyAmountNotMet();
    }

    function _accumulateTotals(
        SettlementTotals memory totals,
        address sellToken,
        uint256 sellAmount,
        uint256 buyAmount
    ) internal view {
        if (sellToken == token0) {
            totals.sold0 += sellAmount;
            totals.buy1 += buyAmount;
        } else {
            totals.sold1 += sellAmount;
            totals.buy0 += buyAmount;
        }
    }

    function _hashOrder(OrderReveal calldata order) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                address(this),
                block.chainid,
                order.trader,
                order.batchId,
                order.sellToken,
                order.sellAmount,
                order.minBuyAmount,
                order.salt
            )
        );
    }

    function _validateReferencePair() internal view {
        address pairToken0 = IUniswapV2PairLike(referencePair).token0();
        address pairToken1 = IUniswapV2PairLike(referencePair).token1();
        bool direct = pairToken0 == token0 && pairToken1 == token1;
        bool reversed = pairToken0 == token1 && pairToken1 == token0;
        if (!direct && !reversed) revert InvalidReferencePair();
    }

    function _referenceReservesForAuctionTokens(uint112 reserve0, uint112 reserve1)
        internal
        view
        returns (uint256 auctionToken0Reserve, uint256 auctionToken1Reserve)
    {
        address pairToken0 = IUniswapV2PairLike(referencePair).token0();
        if (pairToken0 == token0) {
            return (uint256(reserve0), uint256(reserve1));
        }
        return (uint256(reserve1), uint256(reserve0));
    }

    function _isAuctionToken(address token) internal view returns (bool) {
        return token == token0 || token == token1;
    }

    function _toX18(uint256 amount, uint8 decimals_) internal pure returns (uint256) {
        if (decimals_ == 18) return amount;
        if (decimals_ < 18) return amount * (10 ** (18 - decimals_));
        return amount / (10 ** (decimals_ - 18));
    }

    function _fromX18(uint256 amountX18, uint8 decimals_) internal pure returns (uint256) {
        if (decimals_ == 18) return amountX18;
        if (decimals_ < 18) return amountX18 / (10 ** (18 - decimals_));
        return amountX18 * (10 ** (decimals_ - 18));
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        (bool ok, bytes memory data) =
            token.call(abi.encodeWithSelector(bytes4(0x23b872dd), from, to, amount));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert SafeTransferFailed();
    }

    function _safeTransfer(address token, address to, uint256 amount) internal {
        (bool ok, bytes memory data) =
            token.call(abi.encodeWithSelector(bytes4(0xa9059cbb), to, amount));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert SafeTransferFailed();
    }
}
