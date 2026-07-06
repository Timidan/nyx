import { createPublicClient, http } from "viem";
import { createConfig } from "wagmi";
import { injected } from "wagmi/connectors";
import { botChain } from "./chain";

/** Read-only client for logs / contract reads (no wallet required). */
export const publicClient = createPublicClient({
  chain: botChain,
  transport: http(),
});

/** wagmi config — injected connector only, chain 968 only. Switching to an
 *  unknown chain falls back to wallet_addEthereumChain with the rpc.bohr.life
 *  + scan.bohr.life metadata defined on botChain. */
export const wagmiConfig = createConfig({
  chains: [botChain],
  connectors: [injected()],
  transports: { [botChain.id]: http() },
});
