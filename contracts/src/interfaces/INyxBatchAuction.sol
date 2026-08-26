// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface INyxBatchAuction {
    struct OrderReveal {
        address trader;
        uint64 batchId;
        address sellToken;
        uint256 sellAmount;
        uint256 minBuyAmount;
        uint64 expiresAt;
        bytes32 salt;
    }

    struct MatchedOrder {
        bytes32 commitment;
        OrderReveal order;
    }

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
    event BatchOpened(uint64 indexed batchId, uint64 openedAt);
    event AgentUpdateStarted(address indexed oldAgent, address indexed pendingAgent);
    event AgentUpdated(address indexed oldAgent, address indexed newAgent);
    event OwnershipTransferStarted(address indexed oldOwner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);
    event RiskLimitsUpdated(
        address indexed token, uint256 perOrder, uint256 perBatch, uint256 global
    );
    event TraderAllowlistUpdated(address indexed trader, bool allowed);
    event AllowlistModeUpdated(bool enabled);
    event PauseStateUpdated(bool paused);
    event PayoutDeferred(address indexed token, address indexed trader, uint256 amount);
    event PayoutClaimed(address indexed token, address indexed trader, uint256 amount);

    function token0() external view returns (address);
    function token1() external view returns (address);
    function referencePair() external view returns (address);
    function referenceOracle() external view returns (address);
    function agent() external view returns (address);
    function pendingAgent() external view returns (address);
    function owner() external view returns (address);
    function pendingOwner() external view returns (address);
    function currentBatchId() external view returns (uint64);
    function cancelDelaySeconds() external view returns (uint256);
    function maxReferenceDeviationBps() external view returns (uint256);
    function paused() external view returns (bool);
    function allowlistEnabled() external view returns (bool);
    function allowedTraders(address trader) external view returns (bool);
    function totalEscrowed(address token) external view returns (uint256);
    function batchEscrowed(uint64 batchId, address token) external view returns (uint256);

    function submitOrder(
        uint64 batchId,
        bytes32 commitment,
        address sellToken,
        uint256 sellAmount,
        uint64 expiresAt
    ) external;
    function settleBatch(
        uint64 batchId,
        uint256 clearingPriceX18,
        uint8 reason,
        MatchedOrder[] calldata orders
    ) external returns (uint256 matchCount, bytes32 settlementHash);
    function cancelOrder(bytes32 commitment) external;
    function claimPayout(address token) external;

    function hashOrder(OrderReveal calldata order) external view returns (bytes32);
    function getReferencePriceX18() external view returns (uint256 priceX18);
    function previewBuyAmount(address sellToken, uint256 sellAmount, uint256 clearingPriceX18)
        external
        view
        returns (uint256 buyAmount);
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
        );
    function setAgent(address newAgent) external;
    function acceptAgent() external;
    function transferOwnership(address newOwner) external;
    function acceptOwnership() external;
    function setRiskLimits(address token, uint256 perOrder, uint256 perBatch, uint256 global)
        external;
    function setAllowedTrader(address trader, bool allowed) external;
    function setAllowlistEnabled(bool enabled) external;
    function pause() external;
    function unpause() external;
}
