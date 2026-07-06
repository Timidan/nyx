// Shared domain types. These mirror the on-chain shapes so the mock hooks and
// the future viem hooks return identical structures.

export type OrderSide = "buy" | "sell";

/** One settled batch — a render of the `BatchSettled` event. */
export interface Batch {
  batchId: number;
  matchCount: number;
  clearingPrice: number;
  /** reason code 0-4, see lib/reasons.ts */
  reason: number;
  txHash: `0x${string}`;
  settledAt: number; // epoch ms
}

export type AgentStatus = "watching" | "deciding" | "settling";

/** The agent's current heuristic snapshot + status. */
export interface AgentState {
  status: AgentStatus;
  live: boolean;
  /** reason of the most recent clear, null before the first one */
  lastReason: number | null;
  depth: number;
  depthThreshold: number;
  notionalWaiting: number;
  notionalMax: number;
  secsSinceLastClear: number;
  dexPrice: number;
  pair: string;
}

/** Form payload for sealing an order. */
export interface SealedOrder {
  side: OrderSide;
  amount: number;
  limitPrice: number;
}

/** Result of committing a sealed order. */
export interface SealResult {
  commitment: `0x${string}`;
  side: OrderSide;
}
