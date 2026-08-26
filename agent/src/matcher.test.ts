import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildComplementarySettlement, MAX_MATCHED_ORDERS } from "./matcher.js";
import type { Address, QueuedOrder } from "./types.js";

const wbot = "0x0000000000000000000000000000000000000001" as Address;
const bousdt = "0x0000000000000000000000000000000000000002" as Address;
const referencePriceX18 = 10_000000000000000000n;

function order(
  index: number,
  sellToken: Address,
  sellAmount: bigint,
  minBuyAmount: bigint,
  trader = `0x${index.toString(16).padStart(40, "0")}` as Address,
): QueuedOrder {
  const hex = index.toString(16).padStart(2, "0");
  return {
    commitment: `0x${hex.repeat(32)}`,
    order: {
      trader,
      batchId: 1n,
      sellToken,
      sellAmount,
      minBuyAmount,
      expiresAt: 2_000_000_000n,
      salt: `0x${(index + 128).toString(16).padStart(2, "0").repeat(32)}`,
    },
    status: "queued",
    receivedAt: index,
  };
}

function settle(queue: QueuedOrder[], maxDeviationBps = 1000) {
  return buildComplementarySettlement({
    queue,
    referencePriceX18,
    token0: wbot,
    token1: bousdt,
    token0Decimals: 18,
    token1Decimals: 6,
    maxDeviationBps,
  });
}

describe("buildComplementarySettlement", () => {
  it("settles a general 3-order set at one clearing price", () => {
    const settlement = settle([
      order(1, wbot, 1_000000000000000000n, 10_000000n),
      order(2, wbot, 2_000000000000000000n, 20_000000n),
      order(3, bousdt, 30_000000n, 3_000000000000000000n),
    ]);

    assert.ok(settlement);
    assert.equal(settlement.clearingPriceX18, 10_000000000000000000n);
    assert.deepEqual(
      settlement.matches.map((match) => match.commitment),
      [`0x${"01".repeat(32)}`, `0x${"02".repeat(32)}`, `0x${"03".repeat(32)}`],
    );
  });

  it("chooses the largest exact-conserving set with uneven order sizes", () => {
    const settlement = settle([
      order(1, wbot, 1_000000000000000000n, 10_000000n),
      order(2, wbot, 3_000000000000000000n, 30_000000n),
      order(3, bousdt, 5_000000n, 500000000000000000n),
      order(4, bousdt, 35_000000n, 3_500000000000000000n),
    ]);

    assert.ok(settlement);
    assert.equal(settlement.matches.length, 4);
    assert.equal(settlement.clearingPriceX18, 10_000000000000000000n);
  });

  it("excludes an otherwise conserving set when a min buy is not met", () => {
    const settlement = settle([
      order(1, wbot, 1_000000000000000000n, 11_000000n),
      order(2, wbot, 1_000000000000000000n, 10_000000n),
      order(3, bousdt, 10_000000n, 1_000000000000000000n),
    ]);

    assert.ok(settlement);
    assert.deepEqual(
      settlement.matches.map((match) => match.commitment),
      [`0x${"02".repeat(32)}`, `0x${"03".repeat(32)}`],
    );
  });

  it("rejects exact conservation outside the max clearing-price deviation", () => {
    const settlement = settle(
      [
        order(1, wbot, 1_000000000000000000n, 20_000000n),
        order(2, bousdt, 20_000000n, 1_000000000000000000n),
      ],
      500,
    );

    assert.equal(settlement, null);
  });

  it("falls back to the deterministic single exact pair when no larger set exists", () => {
    const settlement = settle([
      order(1, wbot, 1_000000000000000000n, 10_000000n),
      order(2, bousdt, 10_000000n, 1_000000000000000000n),
      order(3, wbot, 2_000000000000000000n, 19_000000n),
    ]);

    assert.ok(settlement);
    assert.deepEqual(
      settlement.matches.map((match) => match.commitment),
      [`0x${"01".repeat(32)}`, `0x${"02".repeat(32)}`],
    );
  });

  it("does not count opposite orders from one wallet as genuine counterflow", () => {
    const self = "0x00000000000000000000000000000000000000aa" as Address;
    const settlement = settle([
      order(1, wbot, 1_000000000000000000n, 10_000000n, self),
      order(2, bousdt, 10_000000n, 1_000000000000000000n, self),
    ]);

    assert.equal(settlement, null);
  });
});

describe("settlement size cap", () => {
  it("never proposes more matched orders than the contract accepts", () => {
    // 33 orders a side clears 66 orders at one price while staying inside the
    // canary batch caps (0.495 WBOT and 4.95 USDT), which is exactly the shape
    // that used to build a settlement the contract reverts.
    const queue: QueuedOrder[] = [];
    for (let i = 0; i < 33; i++) {
      queue.push(order(i + 1, wbot, 15_000000000000000n, 150_000n));
      queue.push(order(i + 40, bousdt, 150_000n, 15_000000000000000n));
    }

    const settlement = settle(queue);

    assert.ok(settlement);
    assert.equal(settlement.matches.length, MAX_MATCHED_ORDERS);

    // Truncating must not break exact conservation, or the contract rejects it
    // for a different reason.
    let soldWbot = 0n;
    let soldUsdt = 0n;
    for (const match of settlement.matches) {
      if (match.order.sellToken === wbot) soldWbot += match.order.sellAmount;
      else soldUsdt += match.order.sellAmount;
    }
    assert.equal((soldWbot * settlement.clearingPriceX18) / 1_000000000000000000n / 1_000000000000n, soldUsdt);
  });
});
