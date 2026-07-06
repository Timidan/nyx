import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { mockChain } from "../lib/mockChain";
import type { Batch } from "../types";

export const batchesQueryKey = ["batches"] as const;

/**
 * Settled batches, newest last. Powers the clearing pulse and the clearing feed.
 *
 * SWAP POINT (viem):
 *   - queryFn: replace `mockChain.getBatches()` with a `publicClient.getLogs`
 *     read of `settlementAbi`'s `BatchSettled` event (src/lib/chain.ts),
 *     decoded into Batch[] (clearingPrice scaled from uint, txHash from the log).
 *   - live updates: replace the `mockChain.subscribe` invalidation with
 *     `publicClient.watchContractEvent({ eventName: 'BatchSettled' })` that
 *     invalidates this query on each new log.
 */
export function useBatches() {
  const qc = useQueryClient();

  useEffect(
    () =>
      mockChain.subscribe(() =>
        qc.invalidateQueries({ queryKey: batchesQueryKey }),
      ),
    [qc],
  );

  return useQuery<Batch[]>({
    queryKey: batchesQueryKey,
    queryFn: () => mockChain.getBatches(),
    initialData: () => mockChain.getBatches(),
  });
}
