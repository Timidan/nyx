import assert from "node:assert/strict";
import test from "node:test";
import { splitBlockRange } from "./chain.js";

test("splitBlockRange respects inclusive RPC range limits", () => {
  assert.deepEqual(splitBlockRange(10n, 10_009n), [
    { fromBlock: 10n, toBlock: 5_009n },
    { fromBlock: 5_010n, toBlock: 10_009n },
  ]);
});

test("splitBlockRange keeps the final partial range", () => {
  assert.deepEqual(splitBlockRange(7n, 12n, 5n), [
    { fromBlock: 7n, toBlock: 11n },
    { fromBlock: 12n, toBlock: 12n },
  ]);
});

test("splitBlockRange handles an empty range and rejects invalid limits", () => {
  assert.deepEqual(splitBlockRange(2n, 1n), []);
  assert.throws(() => splitBlockRange(0n, 1n, 0n), /maxRange must be positive/);
});
