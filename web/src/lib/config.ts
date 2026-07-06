import { getAddress, isAddress } from "viem";
import { nyxBatchAuctionHumanAbi } from "./abi";

// ---------------------------------------------------------------------------
// Runtime mode.
//
// VITE_AUCTION_ADDRESS set   -> LIVE mode: viem reads against NyxBatchAuction
//                               + the agent's local HTTP API.
// VITE_AUCTION_ADDRESS unset -> MOCK mode: the built-in simulator
//                               (lib/mockChain.ts) keeps the demo running
//                               pre-deploy; the header shows "Simulated data".
// ---------------------------------------------------------------------------

function readAuctionAddress(): `0x${string}` | null {
  const raw = import.meta.env.VITE_AUCTION_ADDRESS;
  if (!raw) return null;
  if (!isAddress(raw)) {
    console.warn(
      `VITE_AUCTION_ADDRESS is not a valid address (${raw}); falling back to simulated data.`,
    );
    return null;
  }
  return getAddress(raw);
}

export const AUCTION_ADDRESS = readAuctionAddress();
export const IS_LIVE = AUCTION_ADDRESS !== null;

/** Agent local HTTP API (agent/: AGENT_PORT env, default 8787). */
export const AGENT_API = (
  import.meta.env.VITE_AGENT_API ?? "http://localhost:8787"
).replace(/\/$/, "");

/** Guard for live-only code paths. */
export function requireAuctionAddress(): `0x${string}` {
  if (!AUCTION_ADDRESS) throw new Error("VITE_AUCTION_ADDRESS is not set");
  return AUCTION_ADDRESS;
}

// ---------------------------------------------------------------------------
// ABI resolution: prefer the canonical forge-generated artifact at
// shared/abi/NyxBatchAuction.json when it exists; otherwise fall back to the
// human-readable transcription of docs/INTERFACES.md in ./abi.ts. The glob
// matches zero files today and picks the artifact up automatically once
// `forge build` copies it there.
// ---------------------------------------------------------------------------

const generatedAbiModules = import.meta.glob(
  "../../../shared/abi/NyxBatchAuction.json",
  { eager: true },
);

function resolveAuctionAbi(): typeof nyxBatchAuctionHumanAbi {
  const mod = Object.values(generatedAbiModules)[0] as
    | { default?: unknown }
    | undefined;
  if (!mod) return nyxBatchAuctionHumanAbi;
  const json = (mod.default ?? mod) as { abi?: unknown } | unknown[];
  const abi = Array.isArray(json) ? json : json.abi;
  if (Array.isArray(abi) && abi.length > 0) {
    // Same interface by construction (both derive from INTERFACES.md), so the
    // human-readable type stands in for the generated artifact.
    return abi as unknown as typeof nyxBatchAuctionHumanAbi;
  }
  return nyxBatchAuctionHumanAbi;
}

export const nyxBatchAuctionAbi = resolveAuctionAbi();
