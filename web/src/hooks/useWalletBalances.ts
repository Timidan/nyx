import { useQuery } from "@tanstack/react-query";
import { erc20Abi, formatUnits } from "viem";
import { publicClient } from "../lib/clients";
import { IS_LIVE } from "../lib/config";
import { useBrowserWallet } from "../lib/wallet";
import { useAuctionMeta } from "./useAuctionMeta";
import type { AuctionMeta } from "../types";

/** Connected wallet's spendable balances, human units. */
export interface WalletBalances {
  /** base token (WBOT) */
  base: number;
  /** quote token (BOUSDT) */
  quote: number;
  /** native BOT, for gas */
  bot: number;
}

const MOCK_BALANCES: WalletBalances = { base: 4.2, quote: 13.37, bot: 0.5 };

async function fetchLiveBalances(
  address: `0x${string}`,
  meta: AuctionMeta,
): Promise<WalletBalances> {
  const [native, base, quote] = await Promise.all([
    publicClient.getBalance({ address }),
    publicClient.readContract({
      address: meta.base.address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [address],
    }),
    publicClient.readContract({
      address: meta.quote.address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [address],
    }),
  ]);
  return {
    bot: Number(formatUnits(native, 18)),
    base: Number(formatUnits(base, meta.base.decimals)),
    quote: Number(formatUnits(quote, meta.quote.decimals)),
  };
}

/**
 * Native BOT + WBOT/BOUSDT balances for the connected address, ~12s poll.
 * Live mode: disabled until a wallet connects (callers show a connect hint).
 * Mock mode: static playful balances so the simulator is self-contained.
 */
export function useWalletBalances() {
  const { address } = useBrowserWallet();
  const { data: meta } = useAuctionMeta();

  return useQuery<WalletBalances>({
    queryKey: ["walletBalances", address ?? "none"],
    queryFn: () =>
      IS_LIVE
        ? fetchLiveBalances(address!, meta!)
        : Promise.resolve(MOCK_BALANCES),
    enabled: IS_LIVE ? Boolean(address && meta) : true,
    refetchInterval: 12_000,
  });
}
