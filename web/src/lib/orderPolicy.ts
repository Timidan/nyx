import type { OrderSide } from "../types";

const STATUS_SUBMITTED = 1;
const STATUS_SETTLED = 2;
const STATUS_CANCELLED = 3;
const MAX_UINT64 = (1n << 64n) - 1n;

export type OrderExitPhase =
  | "waiting"
  | "stale"
  | "expired"
  | "settled"
  | "cancelled"
  | "unknown";

export function calculateOrderExpiry(
  latestBlockTimestamp: bigint,
  requestedTtlSeconds: number,
  cancelDelaySeconds: bigint,
): bigint {
  if (
    latestBlockTimestamp < 0n ||
    cancelDelaySeconds <= 0n ||
    !Number.isSafeInteger(requestedTtlSeconds) ||
    requestedTtlSeconds <= 0
  ) {
    throw new Error("Order expiry configuration is invalid.");
  }
  const ttl = BigInt(requestedTtlSeconds);
  const expiresAt =
    latestBlockTimestamp + (ttl < cancelDelaySeconds ? ttl : cancelDelaySeconds);
  if (expiresAt > MAX_UINT64) throw new Error("Order expiry exceeds uint64.");
  return expiresAt;
}

export function deriveOrderExit(input: {
  status: number;
  batchId: bigint;
  currentBatchId: bigint;
  submittedAt: bigint;
  expiresAt: bigint;
  cancelDelay: bigint;
  now: bigint;
}): {
  phase: OrderExitPhase;
  open: boolean;
  cancellable: boolean;
  unlocksInSecs: number | null;
} {
  if (input.status === STATUS_SETTLED) {
    return { phase: "settled", open: false, cancellable: false, unlocksInSecs: null };
  }
  if (input.status === STATUS_CANCELLED) {
    return { phase: "cancelled", open: false, cancellable: false, unlocksInSecs: null };
  }
  if (input.status !== STATUS_SUBMITTED) {
    return { phase: "unknown", open: false, cancellable: false, unlocksInSecs: null };
  }

  const stale = input.batchId < input.currentBatchId;
  const expired = input.now >= input.expiresAt;
  const delayed = input.now >= input.submittedAt + input.cancelDelay;
  const cancellable = stale || expired || delayed;
  const unlockAt =
    input.expiresAt < input.submittedAt + input.cancelDelay
      ? input.expiresAt
      : input.submittedAt + input.cancelDelay;

  return {
    phase: stale ? "stale" : expired ? "expired" : "waiting",
    open: true,
    cancellable,
    unlocksInSecs: cancellable ? 0 : Number(unlockAt - input.now),
  };
}

export function orderStorageKey(
  chainId: number,
  auctionAddress: string,
  walletAddress: string,
): string {
  return `nyx.orders.${chainId}.${auctionAddress.toLowerCase()}.${walletAddress.toLowerCase()}`;
}

export function calculatePriceImprovement(
  side: OrderSide,
  amount: number,
  limitPrice: number,
  clearingPrice: number,
): { bps: number; quoteAmount: number } {
  if (
    amount <= 0 ||
    limitPrice <= 0 ||
    clearingPrice <= 0 ||
    ![amount, limitPrice, clearingPrice].every(Number.isFinite)
  ) {
    return { bps: 0, quoteAmount: 0 };
  }
  const favorableDelta =
    side === "buy" ? limitPrice - clearingPrice : clearingPrice - limitPrice;
  if (favorableDelta <= 0) return { bps: 0, quoteAmount: 0 };
  return {
    bps: Math.round((favorableDelta / limitPrice) * 10_000),
    quoteAmount: amount * favorableDelta,
  };
}
