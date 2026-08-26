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
  if (!raw) {
    if (requiresLiveMode()) throw new Error("VITE_AUCTION_ADDRESS is required in live mode");
    return null;
  }
  if (!isAddress(raw)) {
    if (requiresLiveMode()) throw new Error(`VITE_AUCTION_ADDRESS is not a valid address (${raw})`);
    console.warn(
      `VITE_AUCTION_ADDRESS is not a valid address (${raw}); falling back to simulated data.`,
    );
    return null;
  }
  return getAddress(raw);
}

export const AUCTION_ADDRESS = readAuctionAddress();
export const IS_LIVE = AUCTION_ADDRESS !== null;
export const REQUIRE_LIVE = requiresLiveMode();

/** Agent local HTTP API (agent/: AGENT_PORT env, default 8787). */
export const AGENT_API = (
  import.meta.env.VITE_AGENT_API ?? "http://localhost:8787"
).replace(/\/$/, "");

/** Intended order lifetime. The submit path also clamps this to the auction's
 *  on-chain cancel window, so a bad frontend value cannot exceed the contract
 *  maximum. */
export const ORDER_TTL_SECONDS = readPositiveInteger(
  import.meta.env.VITE_ORDER_TTL_SECONDS,
  15 * 60,
  "VITE_ORDER_TTL_SECONDS",
);

/** Optional operator-owned funnels. Nyx does not require a CRM or identity
 *  vendor; deployments can point these at any existing application channel. */
export const ACCESS_REQUEST_URL = readOptionalHttpUrl(
  import.meta.env.VITE_ACCESS_REQUEST_URL,
  "VITE_ACCESS_REQUEST_URL",
);
export const QUOTE_PROVIDER_APPLY_URL = readOptionalHttpUrl(
  import.meta.env.VITE_QUOTE_PROVIDER_APPLY_URL,
  "VITE_QUOTE_PROVIDER_APPLY_URL",
);

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

function requiresLiveMode(): boolean {
  return import.meta.env.VITE_REQUIRE_LIVE === "true";
}

function readPositiveInteger(
  raw: string | undefined,
  fallback: number,
  name: string,
): number {
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function readOptionalHttpUrl(raw: string | undefined, name: string): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
    return url.toString();
  } catch {
    throw new Error(`${name} must be an http(s) URL`);
  }
}
