/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** NyxBatchAuction address on the configured chain; unset -> simulated data */
  readonly VITE_AUCTION_ADDRESS?: string;
  /** Agent local HTTP API base URL (default http://localhost:8787) */
  readonly VITE_AGENT_API?: string;
  /** "true" -> refuse to start in simulated mode. Set this for any deploy. */
  readonly VITE_REQUIRE_LIVE?: string;
  /** Chain id (default 968, BOT Chain testnet; mainnet is 677) */
  readonly VITE_CHAIN_ID?: string;
  /** RPC endpoint; defaults per chain id */
  readonly VITE_RPC_URL?: string;
  /** Block explorer base URL; defaults per chain id */
  readonly VITE_EXPLORER_URL?: string;
  /** Intended order lifetime in seconds; clamped to the on-chain cancel window */
  readonly VITE_ORDER_TTL_SECONDS?: string;
  /** Optional http(s) application link shown to non-allowlisted traders */
  readonly VITE_ACCESS_REQUEST_URL?: string;
  /** Optional http(s) application link for independent quote providers */
  readonly VITE_QUOTE_PROVIDER_APPLY_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
