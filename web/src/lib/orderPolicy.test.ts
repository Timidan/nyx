import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculateOrderExpiry,
  calculatePriceImprovement,
  deriveOrderExit,
  orderStorageKey,
} from "./orderPolicy.ts";

describe("calculateOrderExpiry", () => {
  it("uses the requested ttl when it is below the contract cancel window", () => {
    assert.equal(calculateOrderExpiry(1_000n, 300, 1_800n), 1_300n);
  });

  it("clamps expiry to the contract cancel window", () => {
    assert.equal(calculateOrderExpiry(1_000n, 3_600, 1_800n), 2_800n);
  });
});

describe("deriveOrderExit", () => {
  const base = {
    status: 1,
    batchId: 7n,
    currentBatchId: 7n,
    submittedAt: 1_000n,
    expiresAt: 1_300n,
    cancelDelay: 1_800n,
  } as const;

  it("makes a stale order immediately refundable", () => {
    assert.deepEqual(
      deriveOrderExit({ ...base, currentBatchId: 8n, now: 1_050n }),
      { phase: "stale", open: true, cancellable: true, unlocksInSecs: 0 },
    );
  });

  it("makes an expired current-round order immediately refundable", () => {
    assert.deepEqual(deriveOrderExit({ ...base, now: 1_300n }), {
      phase: "expired",
      open: true,
      cancellable: true,
      unlocksInSecs: 0,
    });
  });

  it("shows the earliest honest refund time", () => {
    assert.deepEqual(deriveOrderExit({ ...base, now: 1_100n }), {
      phase: "waiting",
      open: true,
      cancellable: false,
      unlocksInSecs: 200,
    });
  });
});

describe("orderStorageKey", () => {
  it("isolates orders by chain, auction deployment, and wallet", () => {
    assert.equal(
      orderStorageKey(677, "0xAAbb", "0xCCdd"),
      "nyx.orders.677.0xaabb.0xccdd",
    );
  });
});

describe("calculatePriceImprovement", () => {
  it("reports quote saved by a buy below its limit", () => {
    assert.deepEqual(calculatePriceImprovement("buy", 2, 100, 98), {
      bps: 200,
      quoteAmount: 4,
    });
  });

  it("reports extra quote received by a sell above its limit", () => {
    assert.deepEqual(calculatePriceImprovement("sell", 3, 100, 101), {
      bps: 100,
      quoteAmount: 3,
    });
  });

  it("never presents adverse execution as improvement", () => {
    assert.deepEqual(calculatePriceImprovement("buy", 2, 100, 101), {
      bps: 0,
      quoteAmount: 0,
    });
  });
});
