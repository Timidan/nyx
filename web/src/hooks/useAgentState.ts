import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { mockChain } from "../lib/mockChain";
import type { AgentState } from "../types";

export const agentStateQueryKey = ["agentState"] as const;

/**
 * The agent's live status + heuristic snapshot. Powers the header status pill
 * and the agent status panel.
 *
 * SWAP POINT (viem):
 *   - queryFn: replace `mockChain.getAgentState()` with derived reads:
 *       depth / notionalWaiting  <- OrderPool pending `OrderSubmitted` logs,
 *       dexPrice                 <- readContract against the BOT DEX pair,
 *       status / lastReason      <- the agent process (or latest BatchSettled).
 *   - Consider a `refetchInterval` (~1s) or an agent-status websocket in place
 *     of the mockChain tick subscription below.
 */
export function useAgentState() {
  const qc = useQueryClient();

  useEffect(
    () =>
      mockChain.subscribe(() =>
        qc.invalidateQueries({ queryKey: agentStateQueryKey }),
      ),
    [qc],
  );

  return useQuery<AgentState>({
    queryKey: agentStateQueryKey,
    queryFn: () => mockChain.getAgentState(),
    initialData: () => mockChain.getAgentState(),
  });
}
