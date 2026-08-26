// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { INyxBatchAuction } from "./interfaces/INyxBatchAuction.sol";
import { INyxPriceOracle } from "./interfaces/INyxPriceOracle.sol";

interface IERC20Minimal {
    function decimals() external view returns (uint8);
    function balanceOf(address account) external view returns (uint256);
}

contract NyxBatchAuction is INyxBatchAuction {
    uint8 private constant STATUS_NONE = 0;
    uint8 private constant STATUS_SUBMITTED = 1;
    uint8 private constant STATUS_SETTLED = 2;
    uint8 private constant STATUS_CANCELLED = 3;
    uint8 private constant MAX_REASON = 4;
    uint256 private constant BPS_DENOMINATOR = 10_000;
    uint256 private constant MAX_REFERENCE_DEVIATION_BPS = 2_000;
    uint256 private constant MAX_MATCHED_ORDERS = 64;
    uint256 private constant X18 = 1e18;

    address public immutable token0;
    address public immutable token1;
    address public immutable referenceOracle;
    uint256 public immutable cancelDelaySeconds;
    uint256 public immutable maxReferenceDeviationBps;

    address public owner;
    address public pendingOwner;
    address public agent;
    address public pendingAgent;
    uint64 public currentBatchId;
    bool public paused = true;
    bool public allowlistEnabled = true;

    uint8 private immutable token0Decimals;
    uint8 private immutable token1Decimals;

    bool private locked;

    mapping(address => mapping(address => uint256)) public claimableBalances;
    mapping(address => bool) public allowedTraders;

    struct RiskLimits {
        uint256 perOrder;
        uint256 perBatch;
        uint256 global;
    }

    mapping(address => RiskLimits) public riskLimits;
    mapping(address => uint256) public totalEscrowed;
    mapping(uint64 => mapping(address => uint256)) public batchEscrowed;

    struct StoredOrder {
        address trader;
        uint64 batchId;
        address sellToken;
        uint256 sellAmount;
        uint64 submittedAt;
        uint64 expiresAt;
        uint8 status;
    }

    mapping(bytes32 => StoredOrder) private ordersByCommitment;

    error OnlyAgent();
    error OnlyOwner();
    error OnlyPendingOwner();
    error ReentrantCall();
    error ZeroAddress();
    error ZeroAmount();
    error InvalidToken();
    error InvalidReason();
    error InvalidDeviationBps();
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
    error ClearingPriceDeviationTooHigh();
    error CancelDelayNotElapsed();
    error SafeTransferFailed();
    error ReceivedAmountMismatch();
    error NoClaimableBalance();
    error ZeroReferenceReserve();
    error OnlyPendingAgent();
    error Paused();
    error RiskLimitsUnset();
    error InvalidRiskLimits();
    error RiskLimitBelowEscrow();
    error TraderNotAllowed();
    error OrderCapExceeded();
    error BatchCapExceeded();
    error GlobalCapExceeded();
    error InvalidExpiry();
    error OrderExpired();
    error SelfTrade();
    error TooManyMatchedOrders();

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

    modifier whenOpen() {
        if (paused) revert Paused();
        _;
    }

    constructor(
        address token0_,
        address token1_,
        address referencePair_,
        address initialAgent,
        uint256 cancelDelaySeconds_,
        uint256 maxReferenceDeviationBps_
    ) {
        if (
            token0_ == address(0) || token1_ == address(0) || referencePair_ == address(0)
                || initialAgent == address(0)
        ) revert ZeroAddress();
        if (token0_ == token1_) revert InvalidToken();
        if (maxReferenceDeviationBps_ > MAX_REFERENCE_DEVIATION_BPS) {
            revert InvalidDeviationBps();
        }

        token0 = token0_;
        token1 = token1_;
        referenceOracle = referencePair_;
        owner = msg.sender;
        agent = initialAgent;
        cancelDelaySeconds = cancelDelaySeconds_;
        maxReferenceDeviationBps = maxReferenceDeviationBps_;
        token0Decimals = IERC20Minimal(token0_).decimals();
        token1Decimals = IERC20Minimal(token1_).decimals();

        _validateReferenceOracle();

        currentBatchId = 1;
        emit AgentUpdated(address(0), initialAgent);
        emit BatchOpened(1, uint64(block.timestamp));
    }

    function submitOrder(
        uint64 batchId,
        bytes32 commitment,
        address sellToken,
        uint256 sellAmount,
        uint64 expiresAt
    ) external whenOpen nonReentrant {
        if (batchId != currentBatchId) revert WrongBatch();
        if (!_isAuctionToken(sellToken)) revert InvalidToken();
        if (sellAmount == 0) revert ZeroAmount();
        // Expiry intentionally follows chain time; small validator skew can only
        // move the submit/exit boundary, not extend it beyond cancelDelaySeconds.
        // forge-lint: disable-next-line(block-timestamp)
        bool expiryNotFuture = expiresAt <= block.timestamp;
        // forge-lint: disable-next-line(block-timestamp)
        bool expiryBeyondLockWindow = uint256(expiresAt) > block.timestamp + cancelDelaySeconds;
        if (expiryNotFuture || expiryBeyondLockWindow) {
            revert InvalidExpiry();
        }
        if (allowlistEnabled && !allowedTraders[msg.sender]) revert TraderNotAllowed();
        if (ordersByCommitment[commitment].status != STATUS_NONE) revert DuplicateCommitment();

        _validateEscrowIncrease(batchId, sellToken, sellAmount);

        ordersByCommitment[commitment] = StoredOrder({
            trader: msg.sender,
            batchId: batchId,
            sellToken: sellToken,
            sellAmount: sellAmount,
            submittedAt: uint64(block.timestamp),
            expiresAt: expiresAt,
            status: STATUS_SUBMITTED
        });

        uint256 balanceBefore = IERC20Minimal(sellToken).balanceOf(address(this));
        _safeTransferFrom(sellToken, msg.sender, address(this), sellAmount);
        uint256 balanceAfter = IERC20Minimal(sellToken).balanceOf(address(this));
        if (balanceAfter < balanceBefore || balanceAfter - balanceBefore != sellAmount) {
            revert ReceivedAmountMismatch();
        }
        totalEscrowed[sellToken] += sellAmount;
        batchEscrowed[batchId][sellToken] += sellAmount;
        emit OrderSubmitted(batchId, commitment, msg.sender, sellToken, sellAmount, expiresAt);
    }

    function settleBatch(
        uint64 batchId,
        uint256 clearingPriceX18,
        uint8 reason,
        MatchedOrder[] calldata matchedOrders
    )
        external
        onlyAgent
        whenOpen
        nonReentrant
        returns (uint256 matchCount, bytes32 settlementHash)
    {
        if (batchId != currentBatchId) {
            revert WrongBatch();
        }
        if (matchedOrders.length == 0) revert EmptySettlement();
        if (matchedOrders.length > MAX_MATCHED_ORDERS) revert TooManyMatchedOrders();
        if (clearingPriceX18 == 0) revert ZeroAmount();
        if (reason > MAX_REASON) revert InvalidReason();
        uint256 referencePriceX18 = getReferencePriceX18();
        _validateClearingPrice(clearingPriceX18, referencePriceX18);

        (bytes32[] memory commitments, uint256[] memory buyAmounts) =
            _validateAndMarkMatchedOrders(batchId, clearingPriceX18, matchedOrders);
        _deliverSettlementPayouts(batchId, matchedOrders, buyAmounts);

        matchCount = matchedOrders.length;
        settlementHash = keccak256(
            abi.encode(block.chainid, address(this), batchId, clearingPriceX18, reason, commitments)
        );
        emit BatchSettled(
            batchId, matchCount, clearingPriceX18, reason, referencePriceX18, settlementHash
        );

        unchecked {
            currentBatchId = batchId + 1;
        }
        emit BatchOpened(currentBatchId, uint64(block.timestamp));
    }

    function _validateAndMarkMatchedOrders(
        uint64 batchId,
        uint256 clearingPriceX18,
        MatchedOrder[] calldata matchedOrders
    ) internal returns (bytes32[] memory commitments, uint256[] memory buyAmounts) {
        SettlementTotals memory totals;
        commitments = new bytes32[](matchedOrders.length);
        buyAmounts = new uint256[](matchedOrders.length);

        for (uint256 i = 0; i < matchedOrders.length; i++) {
            _rejectCrossSideSelfTrade(matchedOrders, i);
            bytes32 commitment = matchedOrders[i].commitment;
            OrderReveal calldata reveal = matchedOrders[i].order;
            uint256 buyAmount = _validateMatchedOrder(batchId, commitment, reveal, clearingPriceX18);
            commitments[i] = commitment;
            buyAmounts[i] = buyAmount;
            _accumulateTotals(totals, reveal.sellToken, reveal.sellAmount, buyAmount);
            // Mark settled as we validate. A commitment repeated within the same call
            // then fails the STATUS_SUBMITTED check above instead of being paid twice.
            ordersByCommitment[commitment].status = STATUS_SETTLED;
            _decreaseEscrow(batchId, reveal.sellToken, reveal.sellAmount);
        }

        if (totals.sold0 != totals.buy0 || totals.sold1 != totals.buy1) {
            revert UnbalancedSettlement();
        }
    }

    function _rejectCrossSideSelfTrade(MatchedOrder[] calldata matchedOrders, uint256 index)
        internal
        pure
    {
        OrderReveal calldata reveal = matchedOrders[index].order;
        for (uint256 j = 0; j < index; j++) {
            OrderReveal calldata priorReveal = matchedOrders[j].order;
            if (priorReveal.trader == reveal.trader && priorReveal.sellToken != reveal.sellToken) {
                revert SelfTrade();
            }
        }
    }

    function _deliverSettlementPayouts(
        uint64 batchId,
        MatchedOrder[] calldata matchedOrders,
        uint256[] memory buyAmounts
    ) internal {
        for (uint256 i = 0; i < matchedOrders.length; i++) {
            bytes32 commitment = matchedOrders[i].commitment;
            OrderReveal calldata reveal = matchedOrders[i].order;
            uint256 buyAmount = buyAmounts[i];
            address buyToken = reveal.sellToken == token0 ? token1 : token0;
            if (!_trySafeTransfer(buyToken, reveal.trader, buyAmount)) {
                claimableBalances[buyToken][reveal.trader] += buyAmount;
                emit PayoutDeferred(buyToken, reveal.trader, buyAmount);
            }
            emit OrderSettled(
                batchId, commitment, reveal.trader, reveal.sellToken, reveal.sellAmount, buyAmount
            );
        }
    }

    function cancelOrder(bytes32 commitment) external nonReentrant {
        StoredOrder storage stored = ordersByCommitment[commitment];
        if (stored.status == STATUS_NONE) revert UnknownOrder();
        if (stored.status != STATUS_SUBMITTED) revert OrderNotSubmitted();
        if (stored.trader != msg.sender) revert UnauthorizedTrader();
        bool batchIsStale = stored.batchId < currentBatchId;
        // forge-lint: disable-next-line(block-timestamp)
        bool orderExpired = block.timestamp >= stored.expiresAt;
        // forge-lint: disable-next-line(block-timestamp)
        bool delayElapsed = block.timestamp >= uint256(stored.submittedAt) + cancelDelaySeconds;
        if (!batchIsStale && !orderExpired && !delayElapsed) {
            revert CancelDelayNotElapsed();
        }

        stored.status = STATUS_CANCELLED;
        _decreaseEscrow(stored.batchId, stored.sellToken, stored.sellAmount);
        _safeTransfer(stored.sellToken, stored.trader, stored.sellAmount);
        emit OrderCancelled(
            stored.batchId, commitment, stored.trader, stored.sellToken, stored.sellAmount
        );
    }

    function claimPayout(address token) external nonReentrant {
        uint256 amount = claimableBalances[token][msg.sender];
        if (amount == 0) revert NoClaimableBalance();
        claimableBalances[token][msg.sender] = 0;
        _safeTransfer(token, msg.sender, amount);
        emit PayoutClaimed(token, msg.sender, amount);
    }

    function hashOrder(OrderReveal calldata order) external view returns (bytes32) {
        return _hashOrder(order);
    }

    function getReferencePriceX18() public view returns (uint256 priceX18) {
        priceX18 = INyxPriceOracle(referenceOracle).priceX18();
        if (priceX18 == 0) revert ZeroReferenceReserve();
    }

    /// @notice Deprecated compatibility alias. New deployments configure an oracle adapter.
    function referencePair() external view returns (address) {
        return referenceOracle;
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
            uint64 expiresAt,
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
            stored.expiresAt,
            stored.status
        );
    }

    function setAgent(address newAgent) external onlyOwner {
        if (newAgent == address(0)) revert ZeroAddress();
        pendingAgent = newAgent;
        emit AgentUpdateStarted(agent, newAgent);
    }

    function acceptAgent() external {
        if (msg.sender != pendingAgent) revert OnlyPendingAgent();
        address oldAgent = agent;
        agent = msg.sender;
        pendingAgent = address(0);
        emit AgentUpdated(oldAgent, msg.sender);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert OnlyPendingOwner();
        address oldOwner = owner;
        owner = msg.sender;
        pendingOwner = address(0);
        emit OwnershipTransferred(oldOwner, msg.sender);
    }

    function setRiskLimits(address token, uint256 perOrder, uint256 perBatch, uint256 global)
        external
        onlyOwner
    {
        if (!paused) revert Paused();
        if (!_isAuctionToken(token)) revert InvalidToken();
        if (perOrder == 0 || perOrder > perBatch || perBatch > global) {
            revert InvalidRiskLimits();
        }
        if (global < totalEscrowed[token]) revert RiskLimitBelowEscrow();
        riskLimits[token] = RiskLimits(perOrder, perBatch, global);
        emit RiskLimitsUpdated(token, perOrder, perBatch, global);
    }

    function setAllowedTrader(address trader, bool allowed) external onlyOwner {
        if (trader == address(0)) revert ZeroAddress();
        allowedTraders[trader] = allowed;
        emit TraderAllowlistUpdated(trader, allowed);
    }

    function setAllowlistEnabled(bool enabled) external onlyOwner {
        if (!paused) revert Paused();
        allowlistEnabled = enabled;
        emit AllowlistModeUpdated(enabled);
    }

    function pause() external onlyOwner {
        paused = true;
        emit PauseStateUpdated(true);
    }

    function unpause() external onlyOwner {
        if (!_riskLimitsConfigured(token0) || !_riskLimitsConfigured(token1)) {
            revert RiskLimitsUnset();
        }
        paused = false;
        emit PauseStateUpdated(false);
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
                || stored.expiresAt != reveal.expiresAt
        ) revert RevealMismatch();
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp >= reveal.expiresAt) revert OrderExpired();

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

    function _validateClearingPrice(uint256 clearingPriceX18, uint256 referencePriceX18)
        internal
        view
    {
        uint256 maxDelta = (referencePriceX18 * maxReferenceDeviationBps) / BPS_DENOMINATOR;
        uint256 lowerBound = referencePriceX18 > maxDelta ? referencePriceX18 - maxDelta : 0;
        uint256 upperBound = referencePriceX18 + maxDelta;
        if (clearingPriceX18 < lowerBound || clearingPriceX18 > upperBound) {
            revert ClearingPriceDeviationTooHigh();
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
                order.expiresAt,
                order.salt
            )
        );
    }

    function _validateReferenceOracle() internal view {
        address base;
        address quote;
        try INyxPriceOracle(referenceOracle).baseToken() returns (address value) {
            base = value;
        } catch {
            revert InvalidReferencePair();
        }
        try INyxPriceOracle(referenceOracle).quoteToken() returns (address value) {
            quote = value;
        } catch {
            revert InvalidReferencePair();
        }
        if (base != token0 || quote != token1) revert InvalidReferencePair();
    }

    function _isAuctionToken(address token) internal view returns (bool) {
        return token == token0 || token == token1;
    }

    function _validateEscrowIncrease(uint64 batchId, address token, uint256 amount) internal view {
        RiskLimits memory limits = riskLimits[token];
        if (limits.perOrder == 0) revert RiskLimitsUnset();
        if (amount > limits.perOrder) revert OrderCapExceeded();
        if (batchEscrowed[batchId][token] + amount > limits.perBatch) {
            revert BatchCapExceeded();
        }
        if (totalEscrowed[token] + amount > limits.global) revert GlobalCapExceeded();
    }

    function _decreaseEscrow(uint64 batchId, address token, uint256 amount) internal {
        totalEscrowed[token] -= amount;
        batchEscrowed[batchId][token] -= amount;
    }

    function _riskLimitsConfigured(address token) internal view returns (bool) {
        return riskLimits[token].perOrder != 0;
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
        if (!_trySafeTransfer(token, to, amount)) revert SafeTransferFailed();
    }

    function _trySafeTransfer(address token, address to, uint256 amount) internal returns (bool) {
        (bool ok, bytes memory data) =
            token.call(abi.encodeWithSelector(bytes4(0xa9059cbb), to, amount));
        if (!ok) return false;
        if (data.length == 0) return true;
        if (data.length != 32) return false;
        uint256 result;
        assembly {
            result := mload(add(data, 32))
        }
        return result == 1;
    }
}
