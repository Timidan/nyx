import type { Hex32, QueuedOrder } from "./types.js";

export interface QuoteRequest {
  commitment: Hex32;
  batchId: string;
  sellToken: `0x${string}`;
  sellAmount: string;
  expiresAt: string;
}

/// Public-flow view for an independent quote provider. Limit, salt, and trader
/// are intentionally absent even though the provider could index public logs.
export function toQuoteRequest(entry: QueuedOrder): QuoteRequest {
  return {
    commitment: entry.commitment,
    batchId: entry.order.batchId.toString(),
    sellToken: entry.order.sellToken,
    sellAmount: entry.order.sellAmount.toString(),
    expiresAt: entry.order.expiresAt.toString(),
  };
}
