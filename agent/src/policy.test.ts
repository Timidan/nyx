import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decide, ReasonCode } from "./policy.js";
import type { QueuedOrder } from "./types.js";

const wbot = "0x0000000000000000000000000000000000000001";
const bousdt = "0x0000000000000000000000000000000000000002";

function queued(partial: Partial<QueuedOrder>): QueuedOrder {
  return {
    commitment: `0x${"11".repeat(32)}`,
    order: {
      trader: "0x00000000000000000000000000000000000000aa",
      batchId: 1n,
      sellToken: wbot,
      sellAmount: 1_000000000000000000n,
      minBuyAmount: 9_000000n,
      salt: `0x${"aa".repeat(32)}`,
    },
    status: "queued",
    receivedAt: 1,
    ...partial,
  };
}

describe("decide", () => {
  it("uses the five frozen reason codes in priority order", () => {
    const buy = queued({});
    const sell = queued({
      commitment: `0x${"22".repeat(32)}`,
      order: {
        trader: "0x00000000000000000000000000000000000000bb",
        batchId: 1n,
        sellToken: bousdt,
        sellAmount: 10_000000n,
        minBuyAmount: 1_000000000000000000n,
        salt: `0x${"bb".repeat(32)}`,
      },
    });

    assert.equal(
      decide({
        queue: [buy, sell, queued({ commitment: `0x${"33".repeat(32)}` })],
        currentBatchId: 1n,
        referencePriceX18: 10_000000000000000000n,
        secondsSinceLastClear: 0,
        token0: wbot,
        token1: bousdt,
        token0Decimals: 18,
        token1Decimals: 6,
        depthMin: 3,
        imbalanceBps: 500,
        notionalMaxX18: 1_000000000000000000000n,
        maxIntervalSeconds: 60,
        dexSpreadBps: 100,
      }).reason,
      ReasonCode.DepthThreshold,
    );

    assert.equal(
      decide({
        queue: [buy, sell],
        currentBatchId: 1n,
        referencePriceX18: 10_000000000000000000n,
        secondsSinceLastClear: 0,
        token0: wbot,
        token1: bousdt,
        token0Decimals: 18,
        token1Decimals: 6,
        depthMin: 3,
        imbalanceBps: 500,
        notionalMaxX18: 1_000000000000000000000n,
        maxIntervalSeconds: 60,
        dexSpreadBps: 100,
      }).reason,
      ReasonCode.Imbalance,
    );

    assert.equal(
      decide({
        queue: [buy],
        currentBatchId: 1n,
        referencePriceX18: 10_000000000000000000n,
        secondsSinceLastClear: 0,
        token0: wbot,
        token1: bousdt,
        token0Decimals: 18,
        token1Decimals: 6,
        depthMin: 3,
        imbalanceBps: 500,
        notionalMaxX18: 9_000000000000000000n,
        maxIntervalSeconds: 60,
        dexSpreadBps: 100,
      }).reason,
      ReasonCode.NotionalWait,
    );

    assert.equal(
      decide({
        queue: [buy],
        currentBatchId: 1n,
        referencePriceX18: 10_000000000000000000n,
        secondsSinceLastClear: 60,
        token0: wbot,
        token1: bousdt,
        token0Decimals: 18,
        token1Decimals: 6,
        depthMin: 3,
        imbalanceBps: 500,
        notionalMaxX18: 100_0000000000000000000n,
        maxIntervalSeconds: 60,
        dexSpreadBps: 100,
      }).reason,
      ReasonCode.MaxInterval,
    );

    assert.equal(
      decide({
        queue: [queued({ order: { ...buy.order, minBuyAmount: 8_000000n } }), sell],
        currentBatchId: 1n,
        referencePriceX18: 10_000000000000000000n,
        secondsSinceLastClear: 0,
        token0: wbot,
        token1: bousdt,
        token0Decimals: 18,
        token1Decimals: 6,
        depthMin: 10,
        imbalanceBps: 0,
        notionalMaxX18: 100_0000000000000000000n,
        maxIntervalSeconds: 600,
        dexSpreadBps: 1000,
      }).reason,
      ReasonCode.DexSpreadTrigger,
    );
  });
});
