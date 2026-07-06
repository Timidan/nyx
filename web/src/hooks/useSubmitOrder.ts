import { useMutation } from "@tanstack/react-query";
import { mockChain } from "../lib/mockChain";
import type { SealResult, SealedOrder } from "../types";

/**
 * Seals an order into the next batch.
 *
 * SWAP POINT (viem):
 *   - mutationFn: replace `mockChain.submitOrder(order)` with
 *       1. compute the Poseidon commitment for the order client-side,
 *       2. `walletClient.writeContract` -> OrderPool.submitOrder(
 *            commitment, token, amount) (orderPoolAbi in src/lib/chain.ts),
 *       3. `publicClient.waitForTransactionReceipt`.
 *     Keep the SealedOrder -> SealResult shape so callers don't change.
 */
export function useSubmitOrder() {
  return useMutation<SealResult, Error, SealedOrder>({
    mutationFn: (order) => mockChain.submitOrder(order),
  });
}
