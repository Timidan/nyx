/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** NyxBatchAuction address on chain 968; unset -> simulated data mode */
  readonly VITE_AUCTION_ADDRESS?: string;
  /** Agent local HTTP API base URL (default http://localhost:8787) */
  readonly VITE_AGENT_API?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
