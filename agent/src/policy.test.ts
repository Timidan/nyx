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
      expiresAt: 2_000_000_000n,
      salt: `0x${"aa".repeat(32)}`,
    },
    status: "queued",
    receivedAt: 1,
    ...partial,
  };
}

describe("decide", () => {
  it("returns the frozen v3 decision trace fields", () => {
    const sellWbot = queued({
      order: {
        ...queued({}).order,
        sellAmount: 2_000000000000000000n,
        minBuyAmount: 18_000000n,
      },
    });
    const sellBousdt = queued({
      commitment: `0x${"22".repeat(32)}`,
      order: {
        trader: "0x00000000000000000000000000000000000000bb",
        batchId: 1n,
        sellToken: bousdt,
        sellAmount: 10_000000n,
        minBuyAmount: 900000000000000000n,
        expiresAt: 2_000_000_000n,
        salt: `0x${"bb".repeat(32)}`,
      },
    });

    const decision = decide({
      queue: [sellWbot, sellBousdt],
      currentBatchId: 1n,
      referencePriceX18: 10_000000000000000000n,
      secondsSinceLastClear: 0,
      token0: wbot,
      token1: bousdt,
      token0Decimals: 18,
      token1Decimals: 6,
      depthMin: 10,
      imbalanceBps: 6000,
      notionalMaxX18: 1_000000000000000000000n,
      maxIntervalSeconds: 60,
      dexSpreadBps: 1000,
    });

    assert.equal(decision.side0X18, 20_000000000000000000n);
    assert.equal(decision.side1X18, 10_000000000000000000n);
    assert.equal(decision.imbalanceBps, 3333);
    assert.equal(decision.dexSpreadOk, true);
  });

  it("reports null imbalance when either side is empty", () => {
    const decision = decide({
      queue: [queued({ order: { ...queued({}).order, minBuyAmount: 10_000000n } })],
      currentBatchId: 1n,
      referencePriceX18: 10_000000000000000000n,
      secondsSinceLastClear: 0,
      token0: wbot,
      token1: bousdt,
      token0Decimals: 18,
      token1Decimals: 6,
      depthMin: 10,
      imbalanceBps: 6000,
      notionalMaxX18: 100_0000000000000000000n,
      maxIntervalSeconds: 60,
      dexSpreadBps: 1000,
    });

    assert.equal(decision.side0X18, 10_000000000000000000n);
    assert.equal(decision.side1X18, 0n);
    assert.equal(decision.imbalanceBps, null);
    assert.equal(decision.dexSpreadOk, false);
  });

  it("ignores unsupported queued tokens in decision trace calculations", () => {
    const decision = decide({
      queue: [
        queued({
          order: {
            ...queued({}).order,
            sellToken: "0x0000000000000000000000000000000000000003",
          },
        }),
      ],
      currentBatchId: 1n,
      referencePriceX18: 10_000000000000000000n,
      secondsSinceLastClear: 0,
      token0: wbot,
      token1: bousdt,
      token0Decimals: 18,
      token1Decimals: 6,
      depthMin: 10,
      imbalanceBps: 6000,
      notionalMaxX18: 100_0000000000000000000n,
      maxIntervalSeconds: 60,
      dexSpreadBps: 1000,
    });

    assert.equal(decision.side0X18, 0n);
    assert.equal(decision.side1X18, 0n);
    assert.equal(decision.imbalanceBps, null);
    assert.equal(decision.dexSpreadOk, false);
  });

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
        expiresAt: 2_000_000_000n,
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
