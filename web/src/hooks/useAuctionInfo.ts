import { useQuery } from "@tanstack/react-query";
import { publicClient } from "../lib/clients";
import { IS_LIVE, nyxBatchAuctionAbi, requireAuctionAddress } from "../lib/config";

export interface AuctionInfo {
  agent: `0x${string}`;
  referenceOracle: `0x${string}`;
}

/** Static proof facts read from the auction: agent wallet + TWAP oracle. */
export function useAuctionInfo() {
  return useQuery<AuctionInfo>({
    queryKey: ["auctionInfo"],
    queryFn: async () => {
      const auction = requireAuctionAddress();
      const [agent, referenceOracle] = await Promise.all([
        publicClient.readContract({
          address: auction,
          abi: nyxBatchAuctionAbi,
          functionName: "agent",
        }),
        publicClient.readContract({
          address: auction,
          abi: nyxBatchAuctionAbi,
          functionName: "referenceOracle",
        }),
      ]);
      return { agent, referenceOracle };
    },
    enabled: IS_LIVE,
    staleTime: Infinity,
    retry: 2,
  });
}
