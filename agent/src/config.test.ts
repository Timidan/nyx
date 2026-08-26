import assert from "node:assert/strict";
import test from "node:test";
import { validateAgentConfig, type AgentConfig } from "./config.js";

const valid = {
  rpcUrl: "https://rpc.botchain.ai",
  chainId: 677,
  auctionAddress: "0x0000000000000000000000000000000000000100",
  wbot: "0x0000000000000000000000000000000000000001",
  bousdt: "0x0000000000000000000000000000000000000002",
  fromBlock: 1n,
  pollMs: 5_000,
  httpHost: "127.0.0.1",
  httpPort: 8787,
  corsOrigin: "https://nyx.example",
  requireApiBearerToken: false,
  rateLimitWindowMs: 60_000,
  rateLimitMaxRequests: 30,
  storePath: "/tmp/nyx-config-test.json",
  depthMin: 2,
  imbalanceBps: 1_500,
  notionalMaxX18: 1n,
  maxIntervalSeconds: 60,
  dexSpreadBps: 500,
  maxClearingDeviationBps: 1_000,
  dryRun: true,
} as AgentConfig;

test("validateAgentConfig accepts the bounded mainnet canary policy", () => {
  assert.equal(validateAgentConfig(valid), valid);
});

for (const [field, value] of [
  ["chainId", 0],
  ["pollMs", 0],
  ["httpPort", 70_000],
  ["rateLimitMaxRequests", 0],
  ["depthMin", 1],
  ["imbalanceBps", 10_001],
  ["maxIntervalSeconds", 0],
  ["dexSpreadBps", 10_001],
  ["maxClearingDeviationBps", 2_001],
] as const) {
  test(`validateAgentConfig rejects invalid ${field}`, () => {
    assert.throws(
      () => validateAgentConfig({ ...valid, [field]: value }),
      new RegExp(field, "i"),
    );
  });
}

test("validateAgentConfig rejects a negative recovery block", () => {
  assert.throws(() => validateAgentConfig({ ...valid, fromBlock: -1n }), /START_BLOCK/);
});

test("validateAgentConfig rejects a non-http browser origin", () => {
  assert.throws(
    () => validateAgentConfig({ ...valid, corsOrigin: "*" }),
    /CORS_ORIGIN/,
  );
});
