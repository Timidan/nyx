import { useQuery } from "@tanstack/react-query";
import { publicClient } from "../lib/clients";
import { IS_LIVE, nyxBatchAuctionAbi, requireAuctionAddress } from "../lib/config";
import { useBrowserWallet } from "../lib/wallet";
import { useAuctionMeta } from "./useAuctionMeta";

export interface TokenRiskState {
  perOrder: bigint;
  perBatch: bigint;
  global: bigint;
  totalEscrowed: bigint;
}

export interface AuctionAccess {
  paused: boolean;
  allowlistEnabled: boolean;
  traderAllowed: boolean;
  base: TokenRiskState;
  quote: TokenRiskState;
}

export function useAuctionAccess() {
  const { address } = useBrowserWallet();
  const { data: meta } = useAuctionMeta();

  return useQuery<AuctionAccess>({
    queryKey: ["auctionAccess", address ?? "none", meta?.base.address, meta?.quote.address],
    queryFn: async () => {
      const auction = requireAuctionAddress();
      const [
        paused,
        allowlistEnabled,
        traderAllowed,
        baseRisk,
        quoteRisk,
        baseEscrowed,
        quoteEscrowed,
      ] = await Promise.all([
        publicClient.readContract({
          address: auction,
          abi: nyxBatchAuctionAbi,
          functionName: "paused",
        }),
        publicClient.readContract({
          address: auction,
          abi: nyxBatchAuctionAbi,
          functionName: "allowlistEnabled",
        }),
        address
          ? publicClient.readContract({
              address: auction,
              abi: nyxBatchAuctionAbi,
              functionName: "allowedTraders",
              args: [address],
            })
          : Promise.resolve(false),
        publicClient.readContract({
          address: auction,
          abi: nyxBatchAuctionAbi,
          functionName: "riskLimits",
          args: [meta!.base.address],
        }),
        publicClient.readContract({
          address: auction,
          abi: nyxBatchAuctionAbi,
          functionName: "riskLimits",
          args: [meta!.quote.address],
        }),
        publicClient.readContract({
          address: auction,
          abi: nyxBatchAuctionAbi,
          functionName: "totalEscrowed",
          args: [meta!.base.address],
        }),
        publicClient.readContract({
          address: auction,
          abi: nyxBatchAuctionAbi,
          functionName: "totalEscrowed",
          args: [meta!.quote.address],
        }),
      ]);

      return {
        paused,
        allowlistEnabled,
        traderAllowed,
        base: {
          perOrder: baseRisk[0],
          perBatch: baseRisk[1],
          global: baseRisk[2],
          totalEscrowed: baseEscrowed,
        },
        quote: {
          perOrder: quoteRisk[0],
          perBatch: quoteRisk[1],
          global: quoteRisk[2],
          totalEscrowed: quoteEscrowed,
        },
      };
    },
    enabled: IS_LIVE && Boolean(meta),
    refetchInterval: 5_000,
  });
}
