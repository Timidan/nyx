import { defineChain } from "viem";

// Chain metadata is env-driven so a mainnet build needs no code change.
// Unset -> BOT Chain testnet (968), which is what local dev and the demo use.
//
// BOT Chain mainnet is chain 677 (rpc.botchain.ai / scan.botchain.ai); testnet
// is 968 (rpc.bohr.life / scan.bohr.life).
export const BOT_CHAIN_MAINNET_ID = 677;

const id = Number(import.meta.env.VITE_CHAIN_ID ?? 968);
const isTestnet = id !== BOT_CHAIN_MAINNET_ID;

export const RPC_URL =
  import.meta.env.VITE_RPC_URL ??
  (isTestnet ? "https://rpc.bohr.life" : "https://rpc.botchain.ai");

export const EXPLORER_URL = (
  import.meta.env.VITE_EXPLORER_URL ??
  (isTestnet ? "https://scan.bohr.life" : "https://scan.botchain.ai")
).replace(/\/$/, "");

/** True only when this build points at BOT Chain mainnet (677). Callers use it
 *  to gate mainnet-specific facts so a testnet build cannot present them as
 *  though they described the chain it is actually talking to. */
export const IS_MAINNET = !isTestnet;

/** Human label for the statusbar, e.g. "BOT Chain testnet · chain 968". */
export const CHAIN_LABEL = `${isTestnet ? "BOT Chain testnet" : "BOT Chain"} · chain ${id}`;

// The browser wallet adapter uses this metadata for wallet_addEthereumChain
// when an injected wallet does not know the configured chain yet.
export const botChain = defineChain({
  id,
  name: isTestnet ? "BOT Chain Testnet" : "BOT Chain",
  nativeCurrency: { name: "BOT", symbol: "BOT", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: {
    default: { name: "BOT Scan", url: EXPLORER_URL },
  },
  testnet: isTestnet,
});
