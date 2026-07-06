import { useEffect } from "react";
import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { fetchAgentStatus } from "../lib/agentApi";
import { publicClient } from "../lib/clients";
import { IS_LIVE, nyxBatchAuctionAbi, requireAuctionAddress } from "../lib/config";
import { fromX18 } from "../lib/format";
import { mockChain } from "../lib/mockChain";
import { auctionMetaQueryKey } from "./useAuctionMeta";
import { batchesQueryKey } from "./useBatches";
import type { AgentState, AgentStatus, AuctionMeta, Batch } from "../types";

export const agentStateQueryKey = ["agentState"] as const;

/** Fallback when /status comes from an older agent build that doesn't send
 *  depthMin — mirrors the agent's default (agent/src/config.ts DEPTH_MIN). */
const FALLBACK_DEPTH_THRESHOLD = 4;

/** agent/src/agent.ts state strings -> the three UI states. */
function mapAgentStatus(agentState: string): AgentStatus {
  if (agentState.startsWith("settl")) return "settling";
  if (["perceiving", "deciding", "simulating"].includes(agentState))
    return "deciding";
  return "watching";
}

/** LIVE: GET {VITE_AGENT_API}/status; if unreachable, degrade to chain-only
 *  reads (currentBatchId + getReferencePriceX18) with status "Watching". */
async function fetchLiveAgentState(qc: QueryClient): Promise<AgentState> {
  // fallback for the last cleared reason: the newest BatchSettled log,
  // already fetched by useBatches into the shared cache
  const batches = qc.getQueryData<Batch[]>(batchesQueryKey);
  const logLastReason = batches?.length
    ? batches[batches.length - 1]!.reason
    : null;
  const meta = qc.getQueryData<AuctionMeta>(auctionMetaQueryKey);
  const pair = meta ? `${meta.base.symbol}/${meta.quote.symbol}` : "—";
  const common = {
    lastReason: logLastReason,
    pair,
    depthThreshold: FALLBACK_DEPTH_THRESHOLD,
  };

  try {
    const s = await fetchAgentStatus();
    // notional readings arrive as decimal-integer strings in notionalUnit;
    // only "token1X18" is understood — anything else hides the meter
    const notional =
      s.notionalWaiting != null &&
      s.notionalMax != null &&
      s.notionalUnit === "token1X18"
        ? {
            notionalWaiting: fromX18(s.notionalWaiting),
            notionalMax: fromX18(s.notionalMax),
            notionalSymbol: meta?.quote.symbol ?? "token1",
          }
        : {};
    return {
      ...common,
      ...notional,
      status: mapAgentStatus(s.agentState),
      live: true,
      // prefer the agent's own reading; fall back to the log derivation
      lastReason: s.lastReason ?? logLastReason,
      reasonCandidate: s.reasonCandidate,
      currentBatchId: s.currentBatchId !== null ? Number(s.currentBatchId) : null,
      depth: s.depth ?? s.queueDepth,
      depthThreshold: s.depthMin ?? FALLBACK_DEPTH_THRESHOLD,
      secsSinceLastClear: s.secondsSinceLastClear,
      dexPrice: s.referencePriceX18 !== null ? fromX18(s.referencePriceX18) : null,
    };
  } catch {
    // agent API unreachable — chain-only degradation
    const degraded: AgentState = {
      ...common,
      status: "watching",
      live: false,
      reasonCandidate: null,
      currentBatchId: null,
      depth: 0,
      secsSinceLastClear: null,
      dexPrice: null,
    };
    try {
      const auction = requireAuctionAddress();
      const [batchId, priceX18] = await Promise.all([
        publicClient.readContract({
          address: auction,
          abi: nyxBatchAuctionAbi,
          functionName: "currentBatchId",
        }),
        publicClient.readContract({
          address: auction,
          abi: nyxBatchAuctionAbi,
          functionName: "getReferencePriceX18",
        }),
      ]);
      return {
        ...degraded,
        currentBatchId: Number(batchId),
        dexPrice: fromX18(priceX18),
      };
    } catch {
      return degraded; // contract also unreachable — empty readings, no crash
    }
  }
}

/**
 * The agent's live status + heuristic snapshot. Powers the header status pill
 * and the agent status panel.
 */
export function useAgentState() {
  const qc = useQueryClient();

  useEffect(() => {
    if (IS_LIVE) return; // live mode polls via refetchInterval instead
    return mockChain.subscribe(() =>
      qc.invalidateQueries({ queryKey: agentStateQueryKey }),
    );
  }, [qc]);

  return useQuery<AgentState>({
    queryKey: agentStateQueryKey,
    queryFn: () =>
      IS_LIVE ? fetchLiveAgentState(qc) : mockChain.getAgentState(),
    initialData: IS_LIVE ? undefined : () => mockChain.getAgentState(),
    refetchInterval: IS_LIVE ? 3000 : false,
  });
}
