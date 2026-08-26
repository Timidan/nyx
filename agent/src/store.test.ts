import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { OrderStore } from "./store.js";
import type { Hex32, OrderReveal } from "./types.js";

test("OrderStore persists the expiry bound into an order commitment", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nyx-store-"));
  try {
    const path = join(directory, "orders.json");
    const commitment = `0x${"11".repeat(32)}` as Hex32;
    const reveal = {
      trader: "0x00000000000000000000000000000000000000aa",
      batchId: 7n,
      sellToken: "0x0000000000000000000000000000000000000001",
      sellAmount: 1_000000000000000000n,
      minBuyAmount: 10_000000n,
      expiresAt: 2_000_000_000n,
      salt: `0x${"22".repeat(32)}`,
    } as OrderReveal;

    const writer = new OrderStore(path);
    await writer.upsert(commitment, reveal);
    const reader = new OrderStore(path);
    await reader.load();

    assert.equal(reader.get(commitment)?.order.expiresAt, 2_000_000_000n);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
