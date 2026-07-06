import { defineChain } from "viem";

// BOT Chain testnet. wagmi's injected connector uses this metadata for
// wallet_addEthereumChain when the wallet doesn't know chain 968 yet.
export const botChain = defineChain({
  id: 968,
  name: "BOT Chain Testnet",
  nativeCurrency: { name: "BOT", symbol: "BOT", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.bohr.life"] } },
  blockExplorers: {
    default: { name: "BOT Scan", url: "https://scan.bohr.life" },
  },
  testnet: true,
});
