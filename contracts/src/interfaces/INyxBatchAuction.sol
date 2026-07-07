// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface INyxBatchAuction {
    struct OrderReveal {
        address trader;
        uint64 batchId;
        address sellToken;
        uint256 sellAmount;
        uint256 minBuyAmount;
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
    event BatchOpened(uint64 indexed batchId, uint64 openedAt);
    event AgentUpdateStarted(address indexed oldAgent, address indexed pendingAgent);
    event AgentUpdated(address indexed oldAgent, address indexed newAgent);

    function token0() external view returns (address);
    function token1() external view returns (address);
    function referencePair() external view returns (address);
    function agent() external view returns (address);
    function pendingAgent() external view returns (address);
    function owner() external view returns (address);
    function currentBatchId() external view returns (uint64);
    function cancelDelaySeconds() external view returns (uint256);
    function maxReferenceDeviationBps() external view returns (uint256);

    function submitOrder(uint64 batchId, bytes32 commitment, address sellToken, uint256 sellAmount)
        external;
    function settleBatch(
        uint64 batchId,
        uint256 clearingPriceX18,
        uint8 reason,
        MatchedOrder[] calldata orders
    ) external returns (uint256 matchCount, bytes32 settlementHash);
    function cancelOrder(bytes32 commitment) external;

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
            uint8 status
        );
    function setAgent(address newAgent) external;
    function acceptAgent() external;
}
