import { useQuery } from "@tanstack/react-query";
import { formatUnits } from "viem";
import { publicClient } from "../lib/clients";
import { IS_LIVE, nyxBatchAuctionAbi, requireAuctionAddress } from "../lib/config";
import { useAuctionMeta } from "./useAuctionMeta";
import type { AuctionMeta } from "../types";

export const batchValuesQueryKey = ["batchValues"] as const;

/**
 * Value settled per round, in quote-token (BOUSDT) units, from OrderSettled
 * logs grouped by batchId. For each settled order the BOUSDT side is
 * sellAmount when sellToken == BOUSDT, else buyAmount — so a round's value is
 * the total BOUSDT that changed hands. Powers the pulse bar heights.
 */
async function fetchLiveBatchValues(
  meta: AuctionMeta,
): Promise<Record<number, number>> {
  const logs = await publicClient.getContractEvents({
    address: requireAuctionAddress(),
    abi: nyxBatchAuctionAbi,
    eventName: "OrderSettled",
    fromBlock: "earliest",
    toBlock: "latest",
  });
  const quoteAddress = meta.quote.address.toLowerCase();
  const sums = new Map<number, bigint>();
  for (const log of logs) {
    const id = Number(log.args.batchId ?? 0n);
    const sellToken = (log.args.sellToken ?? "0x").toLowerCase();
    const quoteSide =
      sellToken === quoteAddress
        ? (log.args.sellAmount ?? 0n)
        : (log.args.buyAmount ?? 0n);
    sums.set(id, (sums.get(id) ?? 0n) + quoteSide);
  }
  const out: Record<number, number> = {};
  for (const [id, total] of sums) {
    out[id] = Number(formatUnits(total, meta.quote.decimals));
  }
  return out;
}

/** batchId -> BOUSDT value settled. Live only; the mock pulse derives stable
 *  pseudo-values locally (the simulator has no OrderSettled stream). */
export function useBatchValues() {
  const { data: meta } = useAuctionMeta();
  return useQuery<Record<number, number>>({
    queryKey: batchValuesQueryKey,
    queryFn: () => fetchLiveBatchValues(meta!),
    enabled: IS_LIVE && Boolean(meta),
    refetchInterval: 5000,
  });
}
