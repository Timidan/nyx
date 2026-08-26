import { formatUnits } from "viem";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { publicClient } from "../lib/clients";
import { IS_LIVE, nyxBatchAuctionAbi, requireAuctionAddress } from "../lib/config";
import { useAuctionMeta } from "./useAuctionMeta";
import type { TokenMeta } from "../types";
import { useBrowserWallet } from "../lib/wallet";

// A settlement pays each matched trader directly. If that transfer fails —
// the token blocks the recipient, or pauses — the contract credits
// claimableBalances[token][trader] instead of reverting the whole batch, and
// the trader withdraws later via claimPayout. Without this panel those funds
// are settled, owed, and invisible.

export const claimableQueryKey = ["claimablePayouts"] as const;

export interface ClaimablePayout {
  token: `0x${string}`;
  symbol: string;
  /** human units */
  amount: number;
}

/** Deployments made before deferred payouts existed have no claimableBalances
 *  function, so the read reverts. Treat that as "nothing claimable" rather
 *  than surfacing an error the user cannot act on. */
async function readClaimable(
  auction: `0x${string}`,
  token: TokenMeta,
  trader: `0x${string}`,
): Promise<ClaimablePayout | null> {
  try {
    const raw = (await publicClient.readContract({
      address: auction,
      abi: nyxBatchAuctionAbi,
      functionName: "claimableBalances",
      args: [token.address, trader],
    })) as bigint;
    if (raw === 0n) return null;
    return {
      token: token.address,
      symbol: token.symbol,
      amount: Number(formatUnits(raw, token.decimals)),
    };
  } catch {
    return null;
  }
}

/** Payouts owed to the connected wallet that a failed transfer left behind. */
export function useClaimablePayouts() {
  const { address } = useBrowserWallet();
  const { data: meta } = useAuctionMeta();

  return useQuery({
    queryKey: [...claimableQueryKey, address ?? null],
    enabled: IS_LIVE && !!address && !!meta,
    refetchInterval: 15_000,
    queryFn: async (): Promise<ClaimablePayout[]> => {
      if (!address || !meta) return [];
      const auction = requireAuctionAddress();
      const found = await Promise.all([
        readClaimable(auction, meta.base, address),
        readClaimable(auction, meta.quote, address),
      ]);
      return found.filter((p): p is ClaimablePayout => p !== null);
    },
  });
}

export function useClaimPayout() {
  const qc = useQueryClient();
  const wallet = useBrowserWallet();
  return useMutation<`0x${string}`, Error, `0x${string}`>({
    mutationFn: async (token) => {
      const auction = requireAuctionAddress();
      const hash = await wallet.sendContract({
        address: auction,
        abi: nyxBatchAuctionAbi,
        functionName: "claimPayout",
        args: [token],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        throw new Error("Claim reverted on-chain.");
      }
      return hash;
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: claimableQueryKey });
    },
  });
}
