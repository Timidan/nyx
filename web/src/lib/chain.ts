import { defineChain } from "viem";

// BOT Chain testnet — used by the future viem/wagmi wiring. Kept here now so the
// swap from mock hooks to real reads only touches the hooks, not the components.
export const botChain = defineChain({
  id: 968,
  name: "BOT Chain Testnet",
  nativeCurrency: { name: "BOT", symbol: "BOT", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.bohr.life"] } },
  blockExplorers: {
    default: { name: "BOT Scan", url: "https://scan.bohr.life" },
  },
  testnet: true,
});

// Deployed contract addresses go here once Day-1 deployment lands.
export const CONTRACTS = {
  orderPool: "0x0000000000000000000000000000000000000000",
  settlement: "0x0000000000000000000000000000000000000000",
} as const;

// Minimal event/function ABIs from plan section 4. Interfaces are not frozen
// yet; treat these as the starting point for the viem swap, not gospel.
export const settlementAbi = [
  {
    type: "event",
    name: "BatchSettled",
    inputs: [
      { name: "batchId", type: "uint256", indexed: true },
      { name: "matchCount", type: "uint256", indexed: false },
      { name: "clearingPrice", type: "uint256", indexed: false },
      { name: "reason", type: "uint8", indexed: false },
    ],
  },
] as const;

export const orderPoolAbi = [
  {
    type: "event",
    name: "OrderSubmitted",
    inputs: [
      { name: "commitment", type: "bytes32", indexed: true },
      { name: "token", type: "address", indexed: true },
      { name: "escrowed", type: "uint256", indexed: false },
    ],
  },
  {
    type: "function",
    name: "submitOrder",
    stateMutability: "nonpayable",
    inputs: [
      { name: "commitment", type: "bytes32" },
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;
