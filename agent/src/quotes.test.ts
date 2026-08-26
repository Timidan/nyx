import assert from "node:assert/strict";
import test from "node:test";
import { toQuoteRequest } from "./quotes.js";
import type { QueuedOrder } from "./types.js";

test("quote requests expose public flow fields but never the sealed limit", () => {
  const queued: QueuedOrder = {
    commitment: `0x${"11".repeat(32)}`,
    order: {
      trader: "0x00000000000000000000000000000000000000aa",
      batchId: 7n,
      sellToken: "0x0000000000000000000000000000000000000001",
      sellAmount: 1_000000000000000000n,
      minBuyAmount: 10_000000n,
      expiresAt: 2_000_000_000n,
      salt: `0x${"22".repeat(32)}`,
    },
    status: "queued",
    receivedAt: 1_900_000_000_000,
  };

  assert.deepEqual(toQuoteRequest(queued), {
    commitment: queued.commitment,
    batchId: "7",
    sellToken: queued.order.sellToken,
    sellAmount: "1000000000000000000",
    expiresAt: "2000000000",
  });
  assert.equal("minBuyAmount" in toQuoteRequest(queued), false);
  assert.equal("salt" in toQuoteRequest(queued), false);
  assert.equal("trader" in toQuoteRequest(queued), false);
});
