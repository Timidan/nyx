import { createPublicClient, http } from "viem";
import { botChain } from "./chain";

/** Read-only client for logs / contract reads (no wallet required). */
export const publicClient = createPublicClient({
  chain: botChain,
  transport: http(),
});
