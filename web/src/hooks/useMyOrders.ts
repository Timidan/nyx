import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { publicClient } from "../lib/clients";
import { IS_LIVE, nyxBatchAuctionAbi, requireAuctionAddress } from "../lib/config";
import { fromX18 } from "../lib/format";
import { loadOrders, type StoredOrder } from "../lib/orderStore";
import { deriveOrderExit, type OrderExitPhase } from "../lib/orderPolicy";
import { useBrowserWallet } from "../lib/wallet";

export type OrderPhase = OrderExitPhase;

export interface OrderSettlementReceipt {
  txHash: `0x${string}`;
  settlementHash: `0x${string}`;
  buyAmount: bigint;
  clearingPrice: number;
  referencePrice: number;
}

export interface MyOrder extends StoredOrder {
  phase: OrderPhase;
  /** submitted/open on-chain (status === SUBMITTED) — eligible to be cancelled
   *  once the cancel delay elapses */
  open: boolean;
  /** true when still open and cancelDelaySeconds has passed since submittedAt */
  cancellable: boolean;
  /** seconds until cancel unlocks (submittedAt + cancelDelay − now); 0 once
   *  unlocked, null when the order is not open */
  cancelUnlocksInSecs: number | null;
  receipt?: OrderSettlementReceipt;
}

const PHASE_WORDS: Record<OrderPhase, string> = {
  waiting: "waiting",
  stale: "stale round",
  expired: "expired",
  settled: "settled",
  cancelled: "cancelled",
  unknown: "unknown",
};

export function phaseWords(phase: OrderPhase): string {
  return PHASE_WORDS[phase];
}

export const myOrdersQueryKey = ["myOrders"] as const;

async function fetchMyOrders(address: `0x${string}`): Promise<MyOrder[]> {
  const stored = loadOrders(address);
  if (stored.length === 0) return [];
  const auction = requireAuctionAddress();

  const [cancelDelay, currentBatchId, settlementLogs, batchLogs] = await Promise.all([
    publicClient.readContract({
      address: auction,
      abi: nyxBatchAuctionAbi,
      functionName: "cancelDelaySeconds",
    }),
    publicClient.readContract({
      address: auction,
      abi: nyxBatchAuctionAbi,
      functionName: "currentBatchId",
    }),
    publicClient.getContractEvents({
      address: auction,
      abi: nyxBatchAuctionAbi,
      eventName: "OrderSettled",
      fromBlock: "earliest",
      toBlock: "latest",
    }),
    publicClient.getContractEvents({
      address: auction,
      abi: nyxBatchAuctionAbi,
      eventName: "BatchSettled",
      fromBlock: "earliest",
      toBlock: "latest",
    }),
  ]);

  const nowSecs = BigInt(Math.floor(Date.now() / 1000));
  const enriched = await Promise.all(
    stored.map(async (order): Promise<MyOrder> => {
      try {
        const [, batchId, , , submittedAt, expiresAt, status] =
          await publicClient.readContract({
            address: auction,
            abi: nyxBatchAuctionAbi,
            functionName: "getOrder",
            args: [order.commitment],
          });
        const exit = deriveOrderExit({
          status,
          batchId,
          currentBatchId,
          submittedAt,
          expiresAt,
          cancelDelay,
          now: nowSecs,
        });
        const settlementLog = settlementLogs.find(
          (log) => log.args.commitment?.toLowerCase() === order.commitment.toLowerCase(),
        );
        const batchLog = settlementLog
          ? batchLogs.find((log) => log.transactionHash === settlementLog.transactionHash)
          : undefined;
        const receipt =
          settlementLog && batchLog?.args.settlementHash
            ? {
                txHash: settlementLog.transactionHash,
                settlementHash: batchLog.args.settlementHash,
                buyAmount: settlementLog.args.buyAmount ?? 0n,
                clearingPrice: fromX18(batchLog.args.clearingPriceX18 ?? 0n),
                referencePrice: fromX18(batchLog.args.referencePriceX18 ?? 0n),
              }
            : undefined;
        return {
          ...order,
          expiresAt: Number(expiresAt),
          phase: exit.phase,
          open: exit.open,
          cancellable: exit.cancellable,
          cancelUnlocksInSecs: exit.unlocksInSecs,
          receipt,
        };
      } catch {
        return {
          ...order,
          phase: "unknown",
          open: false,
          cancellable: false,
          cancelUnlocksInSecs: null,
        };
      }
    }),
  );
  return enriched.reverse(); // newest first
}

/** The connected wallet's locally-tracked orders with live on-chain status.
 *  Live mode only — the my-orders window is hidden in mock mode. */
export function useMyOrders() {
  const { address } = useBrowserWallet();
  return useQuery<MyOrder[]>({
    queryKey: [...myOrdersQueryKey, address ?? "none"],
    queryFn: () => fetchMyOrders(address!),
    enabled: IS_LIVE && Boolean(address),
    refetchInterval: 8000,
  });
}

/** cancelOrder(commitment) through the wallet, then refresh the list. */
export function useCancelOrder() {
  const qc = useQueryClient();
  const wallet = useBrowserWallet();
  return useMutation<`0x${string}`, Error, `0x${string}`>({
    mutationFn: async (commitment) => {
      const auction = requireAuctionAddress();
      const hash = await wallet.sendContract({
        address: auction,
        abi: nyxBatchAuctionAbi,
        functionName: "cancelOrder",
        args: [commitment],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        throw new Error("Cancel reverted on-chain.");
      }
      return hash;
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: myOrdersQueryKey });
    },
  });
}
