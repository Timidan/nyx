import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import {
  getAccount,
  switchChain,
  waitForTransactionReceipt,
  writeContract,
} from "wagmi/actions";
import { botChain } from "../lib/chain";
import { publicClient, wagmiConfig } from "../lib/clients";
import { IS_LIVE, nyxBatchAuctionAbi, requireAuctionAddress } from "../lib/config";
import { loadOrders, type StoredOrder } from "../lib/orderStore";

// Contract order-status constants (contracts/src/NyxBatchAuction.sol).
const STATUS_SUBMITTED = 1;
const STATUS_SETTLED = 2;
const STATUS_CANCELLED = 3;

export type OrderPhase =
  | "waiting" // submitted, current round
  | "stale" // submitted, but the round moved on — refundable
  | "settled"
  | "cancelled"
  | "unknown";

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
}

const PHASE_WORDS: Record<OrderPhase, string> = {
  waiting: "waiting",
  stale: "stale round",
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

  const [cancelDelay, currentBatchId] = await Promise.all([
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
  ]);

  const nowSecs = Math.floor(Date.now() / 1000);
  const enriched = await Promise.all(
    stored.map(async (order): Promise<MyOrder> => {
      try {
        const [, batchId, , , submittedAt, status] =
          await publicClient.readContract({
            address: auction,
            abi: nyxBatchAuctionAbi,
            functionName: "getOrder",
            args: [order.commitment],
          });
        const open = status === STATUS_SUBMITTED;
        const phase: OrderPhase =
          status === STATUS_SETTLED
            ? "settled"
            : status === STATUS_CANCELLED
              ? "cancelled"
              : open
                ? batchId === currentBatchId
                  ? "waiting"
                  : "stale"
                : "unknown";
        const unlockAt = Number(submittedAt) + Number(cancelDelay);
        return {
          ...order,
          phase,
          open,
          cancellable: open && nowSecs >= unlockAt,
          cancelUnlocksInSecs: open ? Math.max(0, unlockAt - nowSecs) : null,
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
  const { address } = useAccount();
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
  return useMutation<`0x${string}`, Error, `0x${string}`>({
    mutationFn: async (commitment) => {
      const auction = requireAuctionAddress();
      // account.chainId is the wallet's REAL chain; getChainId(wagmiConfig)
      // only reflects config state (always 968 — the sole configured chain).
      // Same fix as useSubmitOrder.
      if (getAccount(wagmiConfig).chainId !== botChain.id) {
        await switchChain(wagmiConfig, { chainId: botChain.id });
      }
      const hash = await writeContract(wagmiConfig, {
        address: auction,
        abi: nyxBatchAuctionAbi,
        functionName: "cancelOrder",
        args: [commitment],
        chainId: botChain.id,
      });
      const receipt = await waitForTransactionReceipt(wagmiConfig, { hash });
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
