export type Address = `0x${string}`;
export type Hex32 = `0x${string}`;

export interface OrderReveal {
  trader: Address;
  batchId: bigint;
  sellToken: Address;
  sellAmount: bigint;
  minBuyAmount: bigint;
  expiresAt: bigint;
  salt: Hex32;
}

export type QueueStatus = "queued" | "settled" | "cancelled" | "quarantined";

export interface QueuedOrder {
  commitment: Hex32;
  order: OrderReveal;
  status: QueueStatus;
  receivedAt: number;
  quarantineReason?: string;
}

export interface TokenInfo {
  address: Address;
  symbol: string;
  decimals: number;
}

export interface MarketSnapshot {
  token0: TokenInfo;
  token1: TokenInfo;
  referencePriceX18: bigint;
}

export interface AgentStatus {
  currentBatchId: string | null;
  reasonCandidate: { code: number; label: string } | null;
  queueDepth: number;
  lastReason: number | null;
  depth: number;
  depthMin: number;
  notionalWaiting: string;
  notionalMax: string;
  notionalUnit: string;
  decision: {
    side0X18: string;
    side1X18: string;
    imbalanceBps: number | null;
    dexSpreadOk: boolean;
  };
  config: {
    imbalanceBps: number;
    maxIntervalSeconds: number;
    dexSpreadBps: number;
    maxClearingDeviationBps: number;
  };
  lastTx: Hex32 | null;
  referencePriceX18: string | null;
  secondsSinceLastClear: number;
  agentState: string;
}

export interface MatchedOrder {
  commitment: Hex32;
  order: OrderReveal;
}
