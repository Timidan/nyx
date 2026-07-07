import { absDiff, previewBuyAmount, toX18 } from "./math.js";
import type { QueuedOrder } from "./types.js";

export enum ReasonCode {
  DepthThreshold = 0,
  Imbalance = 1,
  NotionalWait = 2,
  MaxInterval = 3,
  DexSpreadTrigger = 4,
}

export const reasonLabels: Record<ReasonCode, string> = {
  [ReasonCode.DepthThreshold]: "depth-threshold",
  [ReasonCode.Imbalance]: "imbalance",
  [ReasonCode.NotionalWait]: "notional-wait",
  [ReasonCode.MaxInterval]: "max-interval",
  [ReasonCode.DexSpreadTrigger]: "dex-spread-trigger",
};

export interface DecisionInput {
  queue: QueuedOrder[];
  currentBatchId: bigint;
  referencePriceX18: bigint;
  secondsSinceLastClear: number;
  token0: string;
  token1: string;
  token0Decimals: number;
  token1Decimals: number;
  depthMin: number;
  imbalanceBps: number;
  notionalMaxX18: bigint;
  maxIntervalSeconds: number;
  dexSpreadBps: number;
}

export interface Decision {
  reason: ReasonCode | null;
  label: string | null;
  queueDepth: number;
  totalNotionalX18: bigint;
  side0X18: bigint;
  side1X18: bigint;
  imbalanceBps: number | null;
  dexSpreadOk: boolean;
}

export function decide(input: DecisionInput): Decision {
  const queue = input.queue.filter(
    (entry) => entry.status === "queued" && entry.order.batchId === input.currentBatchId,
  );
  const side0 = queue
    .filter((entry) => sameAddress(entry.order.sellToken, input.token0))
    .reduce((sum, entry) => sum + notionalToken1X18(entry, input), 0n);
  const side1 = queue
    .filter((entry) => sameAddress(entry.order.sellToken, input.token1))
    .reduce((sum, entry) => sum + notionalToken1X18(entry, input), 0n);
  const totalNotionalX18 = side0 + side1;
  const imbalanceBps =
    side0 > 0n && side1 > 0n ? Number((absDiff(side0, side1) * 10_000n) / (side0 + side1)) : null;
  const dexSpreadOk = queue.length > 0 && hasDexSpreadOpportunity(queue, input);
  const base = {
    queueDepth: queue.length,
    totalNotionalX18,
    side0X18: side0,
    side1X18: side1,
    imbalanceBps,
    dexSpreadOk,
  };

  if (queue.length >= input.depthMin) {
    return withReason(base, ReasonCode.DepthThreshold);
  }

  if (input.imbalanceBps > 0 && imbalanceBps != null) {
    if (imbalanceBps <= input.imbalanceBps) {
      return withReason(base, ReasonCode.Imbalance);
    }
  }

  if (queue.length > 0 && totalNotionalX18 >= input.notionalMaxX18) {
    return withReason(base, ReasonCode.NotionalWait);
  }

  if (queue.length > 0 && input.secondsSinceLastClear >= input.maxIntervalSeconds) {
    return withReason(base, ReasonCode.MaxInterval);
  }

  if (dexSpreadOk) {
    return withReason(base, ReasonCode.DexSpreadTrigger);
  }

  return { ...base, reason: null, label: null };
}

function withReason(
  base: Pick<
    Decision,
    "queueDepth" | "totalNotionalX18" | "side0X18" | "side1X18" | "imbalanceBps" | "dexSpreadOk"
  >,
  reason: ReasonCode,
): Decision {
  return { ...base, reason, label: reasonLabels[reason] };
}

function notionalToken1X18(
  entry: QueuedOrder,
  input: Pick<
    DecisionInput,
    "token0" | "token1" | "token0Decimals" | "token1Decimals" | "referencePriceX18"
  >,
): bigint {
  if (sameAddress(entry.order.sellToken, input.token0)) {
    const sellX18 = toX18(entry.order.sellAmount, input.token0Decimals);
    return (sellX18 * input.referencePriceX18) / 1_000000000000000000n;
  }
  if (sameAddress(entry.order.sellToken, input.token1)) {
    return toX18(entry.order.sellAmount, input.token1Decimals);
  }
  return 0n;
}

function hasDexSpreadOpportunity(queue: QueuedOrder[], input: DecisionInput): boolean {
  return queue.some((entry) => {
    if (
      !sameAddress(entry.order.sellToken, input.token0) &&
      !sameAddress(entry.order.sellToken, input.token1)
    ) {
      return false;
    }

    const refBuyAmount = previewBuyAmount({
      sellToken: entry.order.sellToken,
      sellAmount: entry.order.sellAmount,
      clearingPriceX18: input.referencePriceX18,
      token0: input.token0,
      token1: input.token1,
      token0Decimals: input.token0Decimals,
      token1Decimals: input.token1Decimals,
    });

    return refBuyAmount * 10_000n >= entry.order.minBuyAmount * BigInt(10_000 + input.dexSpreadBps);
  });
}

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}
