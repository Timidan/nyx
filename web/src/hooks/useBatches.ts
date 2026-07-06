import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { publicClient } from "../lib/clients";
import { IS_LIVE, nyxBatchAuctionAbi, requireAuctionAddress } from "../lib/config";
import { fromX18 } from "../lib/format";
import { mockChain } from "../lib/mockChain";
import type { Batch } from "../types";

export const batchesQueryKey = ["batches"] as const;

/** LIVE: decode every BatchSettled log from the auction. Errors (RPC range
 *  limits, dummy address, cold RPC) degrade to an empty list, never a crash —
 *  the pulse shows its empty state instead. */
async function fetchLiveBatches(): Promise<Batch[]> {
  try {
    const logs = await publicClient.getContractEvents({
      address: requireAuctionAddress(),
      abi: nyxBatchAuctionAbi,
      eventName: "BatchSettled",
      fromBlock: "earliest",
      toBlock: "latest",
    });
    return logs
      .sort((a, b) =>
        a.blockNumber === b.blockNumber
          ? Number(a.logIndex) - Number(b.logIndex)
          : Number(a.blockNumber - b.blockNumber),
      )
      .map((log) => ({
        batchId: Number(log.args.batchId ?? 0n),
        matchCount: Number(log.args.matchCount ?? 0n),
        clearingPrice: fromX18(log.args.clearingPriceX18 ?? 0n),
        reason: Number(log.args.reason ?? 0),
        txHash: log.transactionHash,
        settledAt: 0, // block timestamp not fetched — nothing renders it
        referencePrice: fromX18(log.args.referencePriceX18 ?? 0n),
        settlementHash: log.args.settlementHash,
      }))
      .slice(-200);
  } catch (error) {
    console.warn("BatchSettled log read failed:", error);
    return [];
  }
}

/**
 * Settled batches, newest last. Powers the clearing pulse and the clearing
 * feed. Mode is fixed for the app's lifetime (IS_LIVE), so the branches below
 * are stable across renders.
 */
export function useBatches() {
  const qc = useQueryClient();

  useEffect(() => {
    const invalidate = () => qc.invalidateQueries({ queryKey: batchesQueryKey });
    if (!IS_LIVE) return mockChain.subscribe(invalidate);
    return publicClient.watchContractEvent({
      address: requireAuctionAddress(),
      abi: nyxBatchAuctionAbi,
      eventName: "BatchSettled",
      onLogs: invalidate,
      onError: (error) => console.warn("BatchSettled watch error:", error),
      pollingInterval: 4000,
    });
  }, [qc]);

  return useQuery<Batch[]>({
    queryKey: batchesQueryKey,
    queryFn: () => (IS_LIVE ? fetchLiveBatches() : mockChain.getBatches()),
    initialData: IS_LIVE ? undefined : () => mockChain.getBatches(),
    // safety net in case a watch poll is missed
    refetchInterval: IS_LIVE ? 20_000 : false,
  });
}
