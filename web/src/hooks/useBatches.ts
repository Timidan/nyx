import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { publicClient } from "../lib/clients";
import { IS_LIVE, nyxBatchAuctionAbi, requireAuctionAddress } from "../lib/config";
import { fromX18 } from "../lib/format";
import { mockChain } from "../lib/mockChain";
import type { Batch } from "../types";

export const batchesQueryKey = ["batches"] as const;

/** LIVE: decode every BatchSettled log from the auction. Errors propagate —
 *  React Query keeps the last good data on a failed background refetch, and
 *  before any data lands the components render their empty states. */
async function fetchLiveBatches(): Promise<Batch[]> {
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
}

/**
 * Settled batches, newest last. Powers the clearing pulse and the clearing
 * feed. Mode is fixed for the app's lifetime (IS_LIVE), so the branches below
 * are stable across renders.
 *
 * Live updates poll getLogs on an interval instead of watchContractEvent:
 * rpc.bohr.life accepts eth_newFilter but rejects the follow-up filter reads
 * ("Missing or invalid parameters"), so viem's filter-based watcher errors on
 * every poll and never falls back. Plain getLogs is the call that verifiably
 * works against this RPC.
 */
export function useBatches() {
  const qc = useQueryClient();

  useEffect(() => {
    if (IS_LIVE) return; // live mode polls via refetchInterval below
    return mockChain.subscribe(() =>
      qc.invalidateQueries({ queryKey: batchesQueryKey }),
    );
  }, [qc]);

  return useQuery<Batch[]>({
    queryKey: batchesQueryKey,
    queryFn: () => (IS_LIVE ? fetchLiveBatches() : mockChain.getBatches()),
    initialData: IS_LIVE ? undefined : () => mockChain.getBatches(),
    refetchInterval: IS_LIVE ? 5000 : false,
  });
}
