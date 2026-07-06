// Shared domain types. The mock hooks and the live (viem) hooks return
// identical structures so components never care which mode is running.

export type OrderSide = "buy" | "sell";

/** One settled batch — a render of the `BatchSettled` event (frozen v1). */
export interface Batch {
  batchId: number;
  matchCount: number;
  /** human units — clearingPriceX18 formatted through 1e18 in live mode */
  clearingPrice: number;
  /** reason code 0-4, see lib/reasons.ts */
  reason: number;
  txHash: `0x${string}`;
  settledAt: number; // epoch ms (0 for live logs — not displayed)
  /** referencePriceX18 formatted through 1e18; live mode only */
  referencePrice?: number;
  settlementHash?: `0x${string}`;
}

export type AgentStatus = "watching" | "deciding" | "settling";

/** The agent's current heuristic snapshot + status. */
export interface AgentState {
  status: AgentStatus;
  /** true when the agent process is reachable (mock: always true) */
  live: boolean;
  /** reason of the most recent clear, null before the first one */
  lastReason: number | null;
  /** what the agent is leaning toward for the next clear (live API only) */
  reasonCandidate?: { code: number; label: string } | null;
  currentBatchId?: number | null;
  depth: number;
  depthThreshold: number;
  /** not exposed by the agent /status API — present in mock mode only */
  notionalWaiting?: number;
  notionalMax?: number;
  secsSinceLastClear: number | null;
  dexPrice: number | null;
  pair: string;
}

/** Form payload for sealing an order. Amount is denominated in the base
 *  (token0) asset; limit price is quote (token1) per base. */
export interface SealedOrder {
  side: OrderSide;
  amount: number;
  limitPrice: number;
}

/** OrderReveal serialized for the agent HTTP API (bigints as strings). */
export interface OrderRevealWire {
  trader: `0x${string}`;
  batchId: string;
  sellToken: `0x${string}`;
  sellAmount: string;
  minBuyAmount: string;
  salt: `0x${string}`;
}

/** Result of committing a sealed order. */
export interface SealResult {
  commitment: `0x${string}`;
  side: OrderSide;
  txHash: `0x${string}` | null;
  /** false when the on-chain commit landed but the agent POST failed */
  revealDelivered: boolean;
  /** kept so the reveal POST can be retried; null in mock mode */
  reveal: OrderRevealWire | null;
}

/** ERC-20 metadata for the auction's token pair. */
export interface TokenMeta {
  address: `0x${string}`;
  symbol: string;
  decimals: number;
}

export interface AuctionMeta {
  /** token0 — the asset the form's amount field is denominated in */
  base: TokenMeta;
  /** token1 — the asset limit prices are quoted in */
  quote: TokenMeta;
}
