import { AGENT_API } from "./config";
import type { OrderRevealWire } from "../types";

// Frontend <-> agent local HTTP API (docs/INTERFACES.md "Agent local API").
// GET /status, POST /orders. GET /health exists but the UI doesn't need it.

/** Shape of GET /status — frozen in INTERFACES.md, mirrors agent/src/types.ts.
 *  The second block is additive (Jul 6 update); every field there stays
 *  optional so the UI keeps working against an older agent build. */
export interface AgentApiStatus {
  currentBatchId: string | null;
  reasonCandidate: { code: number; label: string } | null;
  queueDepth: number;
  lastTx: string | null;
  referencePriceX18: string | null;
  secondsSinceLastClear: number;
  agentState: string;
  /** reason code of the most recent BatchSettled the agent knows about */
  lastReason?: number | null;
  /** alias for queueDepth */
  depth?: number;
  /** configured DEPTH_MIN threshold */
  depthMin?: number;
  /** queued escrow notional, decimal integer in notionalUnit */
  notionalWaiting?: string;
  /** configured notional threshold, decimal integer in notionalUnit */
  notionalMax?: string;
  /** "token1X18": token1-normalized X18 units */
  notionalUnit?: string;
}

export async function fetchAgentStatus(): Promise<AgentApiStatus> {
  const res = await fetch(`${AGENT_API}/status`, {
    signal: AbortSignal.timeout(2500),
  });
  if (!res.ok) throw new Error(`agent /status responded ${res.status}`);
  return (await res.json()) as AgentApiStatus;
}

/** POST the OrderReveal preimage after the commitment lands on-chain. The
 *  agent parses bigint fields from decimal strings (agent/src/http.ts). */
export async function postOrderReveal(reveal: OrderRevealWire): Promise<void> {
  const res = await fetch(`${AGENT_API}/orders`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(reveal),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = ((await res.json()) as { error?: string }).error ?? "";
    } catch {
      // non-JSON error body — status code is enough
    }
    throw new Error(detail || `agent /orders responded ${res.status}`);
  }
}
