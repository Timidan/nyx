import { erc20Abi } from "viem";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { publicClient } from "../lib/clients";
import { IS_LIVE, nyxBatchAuctionAbi, requireAuctionAddress } from "../lib/config";
import type { AuctionMeta, TokenMeta } from "../types";

// The auction's token pair: token0 (base — the form's amount asset) and
// token1 (quote — the limit-price asset), with symbols/decimals for labels
// and parseUnits.

export const auctionMetaQueryKey = ["auctionMeta"] as const;

/** Matches the real WBOT/BOUSDT pair so the simulator reads consistently. */
const MOCK_META: AuctionMeta = {
  base: {
    address: "0xD5452816194a3784dBa983426cCe7c122F4abd30",
    symbol: "WBOT",
    decimals: 18,
  },
  quote: {
    address: "0xAfea2A5e0587615ceD6972e271E5bfe8622ebcA2",
    symbol: "BOUSDT",
    decimals: 18,
  },
};

async function fetchTokenMeta(address: `0x${string}`): Promise<TokenMeta> {
  const [symbol, decimals] = await Promise.all([
    publicClient.readContract({ address, abi: erc20Abi, functionName: "symbol" }),
    publicClient.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
  ]);
  return { address, symbol, decimals };
}

async function fetchAuctionMeta(): Promise<AuctionMeta> {
  const auction = requireAuctionAddress();
  const [token0, token1] = await Promise.all([
    publicClient.readContract({
      address: auction,
      abi: nyxBatchAuctionAbi,
      functionName: "token0",
    }),
    publicClient.readContract({
      address: auction,
      abi: nyxBatchAuctionAbi,
      functionName: "token1",
    }),
  ]);
  const [base, quote] = await Promise.all([
    fetchTokenMeta(token0),
    fetchTokenMeta(token1),
  ]);
  return { base, quote };
}

export function auctionMetaQueryOptions() {
  return queryOptions<AuctionMeta>({
    queryKey: auctionMetaQueryKey,
    queryFn: () => (IS_LIVE ? fetchAuctionMeta() : Promise.resolve(MOCK_META)),
    staleTime: Infinity,
    retry: 2,
  });
}

export function useAuctionMeta() {
  return useQuery(auctionMetaQueryOptions());
}
