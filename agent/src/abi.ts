export const nyxBatchAuctionAbi = [
  {
    type: "function",
    name: "currentBatchId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint64" }],
  },
  {
    type: "function",
    name: "maxReferenceDeviationBps",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "agent",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "pendingAgent",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "getReferencePriceX18",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "priceX18", type: "uint256" }],
  },
  {
    type: "function",
    name: "hashOrder",
    stateMutability: "view",
    inputs: [
      {
        name: "order",
        type: "tuple",
        components: [
          { name: "trader", type: "address" },
          { name: "batchId", type: "uint64" },
          { name: "sellToken", type: "address" },
          { name: "sellAmount", type: "uint256" },
          { name: "minBuyAmount", type: "uint256" },
          { name: "salt", type: "bytes32" },
        ],
      },
    ],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "getOrder",
    stateMutability: "view",
    inputs: [{ name: "commitment", type: "bytes32" }],
    outputs: [
      { name: "trader", type: "address" },
      { name: "batchId", type: "uint64" },
      { name: "sellToken", type: "address" },
      { name: "sellAmount", type: "uint256" },
      { name: "submittedAt", type: "uint64" },
      { name: "status", type: "uint8" },
    ],
  },
  {
    type: "function",
    name: "settleBatch",
    stateMutability: "nonpayable",
    inputs: [
      { name: "batchId", type: "uint64" },
      { name: "clearingPriceX18", type: "uint256" },
      { name: "reason", type: "uint8" },
      {
        name: "orders",
        type: "tuple[]",
        components: [
          { name: "commitment", type: "bytes32" },
          {
            name: "order",
            type: "tuple",
            components: [
              { name: "trader", type: "address" },
              { name: "batchId", type: "uint64" },
              { name: "sellToken", type: "address" },
              { name: "sellAmount", type: "uint256" },
              { name: "minBuyAmount", type: "uint256" },
              { name: "salt", type: "bytes32" },
            ],
          },
        ],
      },
    ],
    outputs: [
      { name: "matchCount", type: "uint256" },
      { name: "settlementHash", type: "bytes32" },
    ],
  },
  {
    type: "event",
    name: "OrderSubmitted",
    inputs: [
      { name: "batchId", type: "uint64", indexed: true },
      { name: "commitment", type: "bytes32", indexed: true },
      { name: "trader", type: "address", indexed: true },
      { name: "sellToken", type: "address", indexed: false },
      { name: "sellAmount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "OrderSettled",
    inputs: [
      { name: "batchId", type: "uint64", indexed: true },
      { name: "commitment", type: "bytes32", indexed: true },
      { name: "trader", type: "address", indexed: true },
      { name: "sellToken", type: "address", indexed: false },
      { name: "sellAmount", type: "uint256", indexed: false },
      { name: "buyAmount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "OrderCancelled",
    inputs: [
      { name: "batchId", type: "uint64", indexed: true },
      { name: "commitment", type: "bytes32", indexed: true },
      { name: "trader", type: "address", indexed: true },
      { name: "sellToken", type: "address", indexed: false },
      { name: "refunded", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "BatchSettled",
    inputs: [
      { name: "batchId", type: "uint64", indexed: true },
      { name: "matchCount", type: "uint256", indexed: false },
      { name: "clearingPriceX18", type: "uint256", indexed: false },
      { name: "reason", type: "uint8", indexed: true },
      { name: "referencePriceX18", type: "uint256", indexed: false },
      { name: "settlementHash", type: "bytes32", indexed: false },
    ],
  },
  {
    type: "event",
    name: "AgentUpdateStarted",
    inputs: [
      { name: "oldAgent", type: "address", indexed: true },
      { name: "pendingAgent", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "AgentUpdated",
    inputs: [
      { name: "oldAgent", type: "address", indexed: true },
      { name: "newAgent", type: "address", indexed: true },
    ],
  },
] as const;

export const erc20Abi = [
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;

export const pairAbi = [
  {
    type: "function",
    name: "token0",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "token1",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "getReserves",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "reserve0", type: "uint112" },
      { name: "reserve1", type: "uint112" },
      { name: "blockTimestampLast", type: "uint32" },
    ],
  },
] as const;
