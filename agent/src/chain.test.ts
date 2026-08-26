import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSuccessfulReceipt,
  selectLatestSettlementLog,
  sendSettleWithGasBuffer,
  splitBlockRange,
} from "./chain.js";

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

test("assertSuccessfulReceipt rejects a mined revert", () => {
  assert.doesNotThrow(() => assertSuccessfulReceipt({ status: "success" }));
  assert.throws(
    () => assertSuccessfulReceipt({ status: "reverted" }),
    /settlement transaction reverted/i,
  );
});

test("selectLatestSettlementLog uses block and log order, not response order", () => {
  const latest = selectLatestSettlementLog([
    { args: { reason: 1 }, blockNumber: 15n, logIndex: 2 },
    { args: { reason: 4 }, blockNumber: 16n, logIndex: 0 },
    { args: { reason: 3 }, blockNumber: 15n, logIndex: 9 },
  ]);

  assert.equal(latest?.args.reason, 4);
  assert.equal(latest?.blockNumber, 16n);
});

test("sendSettleWithGasBuffer does not replay an ambiguous write failure", async () => {
  let writes = 0;
  const publicClient = {
    estimateContractGas: async () => 100_000n,
  };
  const walletClient = {
    writeContract: async (request: { gas?: bigint }) => {
      writes += 1;
      assert.equal(request.gas, 125_000n);
      throw new Error("RPC disconnected after send");
    },
  };

  await assert.rejects(
    sendSettleWithGasBuffer(publicClient as never, walletClient as never, {} as never),
    /RPC disconnected after send/,
  );
  assert.equal(writes, 1);
});
