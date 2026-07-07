import { useQuery } from "@tanstack/react-query";
import { publicClient } from "../lib/clients";
import { IS_LIVE, nyxBatchAuctionAbi, requireAuctionAddress } from "../lib/config";

export interface AuctionInfo {
  agent: `0x${string}`;
  referencePair: `0x${string}`;
}

/** Static proof facts read from the auction: agent wallet + BOT DEX pair. */
export function useAuctionInfo() {
  return useQuery<AuctionInfo>({
    queryKey: ["auctionInfo"],
    queryFn: async () => {
      const auction = requireAuctionAddress();
      const [agent, referencePair] = await Promise.all([
        publicClient.readContract({
          address: auction,
          abi: nyxBatchAuctionAbi,
          functionName: "agent",
        }),
        publicClient.readContract({
          address: auction,
          abi: nyxBatchAuctionAbi,
          functionName: "referencePair",
        }),
      ]);
      return { agent, referencePair };
    },
    enabled: IS_LIVE,
    staleTime: Infinity,
    retry: 2,
  });
}
