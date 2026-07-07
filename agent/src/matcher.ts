import { absDiff, previewBuyAmount, toX18 } from "./math.js";
import type { Address, MatchedOrder, OrderReveal, QueuedOrder } from "./types.js";

const X18 = 1_000000000000000000n;
const EXHAUSTIVE_ORDER_LIMIT = 16;

export interface SettlementParams {
  queue: QueuedOrder[];
  referencePriceX18: bigint;
  token0: Address;
  token1: Address;
  token0Decimals: number;
  token1Decimals: number;
  maxDeviationBps: number;
}

export interface Settlement {
  clearingPriceX18: bigint;
  matches: MatchedOrder[];
}

interface OrderSubset {
  orders: QueuedOrder[];
  sellX18: bigint;
}

interface ScoredSettlement extends Settlement {
  totalNotionalX18: bigint;
  deviationBps: bigint;
  key: string;
}

export function buildComplementarySettlement(params: SettlementParams): Settlement | null {
  const sell0 = sortedSide(params.queue, params.token0);
  const sell1 = sortedSide(params.queue, params.token1);
  if (sell0.length === 0 || sell1.length === 0) return null;

  if (sell0.length + sell1.length <= EXHAUSTIVE_ORDER_LIMIT) {
    return searchExactMultiOrderSettlement(sell0, sell1, params);
  }

  return searchExactMultiPairSettlement(sell0, sell1, params);
}

function searchExactMultiOrderSettlement(
  sell0: QueuedOrder[],
  sell1: QueuedOrder[],
  params: SettlementParams,
): Settlement | null {
  let best: ScoredSettlement | null = null;
  const sell0Subsets = enumerateSubsets(sell0, params.token0Decimals);
  const sell1Subsets = enumerateSubsets(sell1, params.token1Decimals);

  for (const left of sell0Subsets) {
    for (const right of sell1Subsets) {
      for (const clearingPriceX18 of candidatePrices(left.sellX18, right.sellX18)) {
        const candidate = scoreSettlement([...left.orders, ...right.orders], clearingPriceX18, params);
        best = betterSettlement(best, candidate);
      }
    }
  }

  return best == null ? null : { clearingPriceX18: best.clearingPriceX18, matches: best.matches };
}

function searchExactMultiPairSettlement(
  sell0: QueuedOrder[],
  sell1: QueuedOrder[],
  params: SettlementParams,
): Settlement | null {
  const pairsByPrice = new Map<string, QueuedOrder[][]>();

  for (const left of sell0) {
    for (const right of sell1) {
      const leftX18 = toX18(left.order.sellAmount, params.token0Decimals);
      const rightX18 = toX18(right.order.sellAmount, params.token1Decimals);
      for (const clearingPriceX18 of candidatePrices(leftX18, rightX18)) {
        const candidate = scoreSettlement([left, right], clearingPriceX18, params);
        if (!candidate) continue;
        const key = clearingPriceX18.toString();
        const pairs = pairsByPrice.get(key) ?? [];
        pairs.push([left, right]);
        pairsByPrice.set(key, pairs);
      }
    }
  }

  let best: ScoredSettlement | null = null;
  for (const [price, pairs] of pairsByPrice) {
    const used = new Set<string>();
    const selected: QueuedOrder[] = [];
    const orderedPairs = [...pairs].sort((a, b) => pairKey(a).localeCompare(pairKey(b)));
    for (const [left, right] of orderedPairs) {
      if (used.has(left.commitment) || used.has(right.commitment)) continue;
      used.add(left.commitment);
      used.add(right.commitment);
      selected.push(left, right);
    }

    const candidate = scoreSettlement(selected, BigInt(price), params);
    best = betterSettlement(best, candidate);
  }

  return best == null ? null : { clearingPriceX18: best.clearingPriceX18, matches: best.matches };
}

function scoreSettlement(
  orders: QueuedOrder[],
  clearingPriceX18: bigint,
  params: SettlementParams,
): ScoredSettlement | null {
  if (!withinDeviation(clearingPriceX18, params.referencePriceX18, params.maxDeviationBps)) {
    return null;
  }

  let sold0 = 0n;
  let sold1 = 0n;
  let buy0 = 0n;
  let buy1 = 0n;
  let totalNotionalX18 = 0n;

  for (const entry of orders) {
    const buyAmount = preview(entry.order, { ...params, clearingPriceX18 });
    if (buyAmount < entry.order.minBuyAmount) return null;

    if (sameAddress(entry.order.sellToken, params.token0)) {
      sold0 += entry.order.sellAmount;
      buy1 += buyAmount;
      const sellX18 = toX18(entry.order.sellAmount, params.token0Decimals);
      totalNotionalX18 += (sellX18 * clearingPriceX18) / X18;
    } else if (sameAddress(entry.order.sellToken, params.token1)) {
      sold1 += entry.order.sellAmount;
      buy0 += buyAmount;
      totalNotionalX18 += toX18(entry.order.sellAmount, params.token1Decimals);
    }
  }

  if (sold0 !== buy0 || sold1 !== buy1) return null;

  const sorted = sortOrders(orders);
  const key = sorted.map((entry) => entry.commitment).join("|");
  return {
    clearingPriceX18,
    matches: sorted.map((entry) => ({ commitment: entry.commitment, order: entry.order })),
    totalNotionalX18,
    deviationBps: deviationBps(clearingPriceX18, params.referencePriceX18),
    key,
  };
}

function enumerateSubsets(orders: QueuedOrder[], decimals: number): OrderSubset[] {
  const subsets: OrderSubset[] = [];
  const maskCount = 1 << orders.length;
  for (let mask = 1; mask < maskCount; mask++) {
    const selected: QueuedOrder[] = [];
    let sellX18 = 0n;
    for (let index = 0; index < orders.length; index++) {
      if ((mask & (1 << index)) === 0) continue;
      const entry = orders[index];
      selected.push(entry);
      sellX18 += toX18(entry.order.sellAmount, decimals);
    }
    if (sellX18 > 0n) subsets.push({ orders: selected, sellX18 });
  }
  return subsets;
}

function candidatePrices(sell0X18: bigint, sell1X18: bigint): bigint[] {
  if (sell0X18 === 0n || sell1X18 === 0n) return [];
  const numerator = sell1X18 * X18;
  const floor = numerator / sell0X18;
  const ceil = (numerator + sell0X18 - 1n) / sell0X18;
  if (floor === 0n) return ceil === 0n ? [] : [ceil];
  return floor === ceil ? [floor] : [floor, ceil];
}

function betterSettlement(
  current: ScoredSettlement | null,
  candidate: ScoredSettlement | null,
): ScoredSettlement | null {
  if (!candidate) return current;
  if (!current) return candidate;
  if (candidate.matches.length !== current.matches.length) {
    return candidate.matches.length > current.matches.length ? candidate : current;
  }
  if (candidate.totalNotionalX18 !== current.totalNotionalX18) {
    return candidate.totalNotionalX18 > current.totalNotionalX18 ? candidate : current;
  }
  if (candidate.deviationBps !== current.deviationBps) {
    return candidate.deviationBps < current.deviationBps ? candidate : current;
  }
  return candidate.key < current.key ? candidate : current;
}

function sortedSide(queue: QueuedOrder[], token: Address): QueuedOrder[] {
  return sortOrders(
    queue.filter((entry) => entry.status === "queued" && sameAddress(entry.order.sellToken, token)),
  );
}

function sortOrders(orders: QueuedOrder[]): QueuedOrder[] {
  return [...orders].sort((a, b) => {
    if (a.receivedAt !== b.receivedAt) return a.receivedAt - b.receivedAt;
    return a.commitment.localeCompare(b.commitment);
  });
}

function pairKey(pair: QueuedOrder[]): string {
  return pair.map((entry) => entry.commitment).sort().join("|");
}

function preview(
  order: OrderReveal,
  params: {
    clearingPriceX18: bigint;
    token0: Address;
    token1: Address;
    token0Decimals: number;
    token1Decimals: number;
  },
): bigint {
  return previewBuyAmount({
    sellToken: order.sellToken,
    sellAmount: order.sellAmount,
    clearingPriceX18: params.clearingPriceX18,
    token0: params.token0,
    token1: params.token1,
    token0Decimals: params.token0Decimals,
    token1Decimals: params.token1Decimals,
  });
}

function withinDeviation(price: bigint, reference: bigint, maxDeviationBps: number): boolean {
  if (reference === 0n) return false;
  return deviationBps(price, reference) <= BigInt(maxDeviationBps);
}

function deviationBps(price: bigint, reference: bigint): bigint {
  return (absDiff(price, reference) * 10_000n) / reference;
}

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}
