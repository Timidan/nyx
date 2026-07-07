import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NyxAgent } from "./agent.js";
import type { AgentConfig } from "./config.js";

const config: AgentConfig = {
  rpcUrl: "http://127.0.0.1:8545",
  chainId: 968,
  auctionAddress: "0x0000000000000000000000000000000000000100",
  wbot: "0x0000000000000000000000000000000000000001",
  bousdt: "0x0000000000000000000000000000000000000002",
  dexPair: "0x0000000000000000000000000000000000000003",
  fromBlock: 0n,
  pollMs: 5000,
  httpHost: "127.0.0.1",
  httpPort: 8787,
  corsOrigin: "http://localhost:5190",
  requireApiBearerToken: false,
  rateLimitWindowMs: 60_000,
  rateLimitMaxRequests: 60,
  storePath: "/tmp/nyx-agent-status-test.json",
  depthMin: 4,
  imbalanceBps: 1500,
  notionalMaxX18: 1_000000000000000000n,
  maxIntervalSeconds: 60,
  dexSpreadBps: 500,
  maxClearingDeviationBps: 1000,
  dryRun: false,
};

describe("NyxAgent status", () => {
  it("includes the frozen v3 decision trace and config fields", () => {
    const agent = new NyxAgent(config);
    const unsafe = agent as unknown as {
      lastDecision: {
        reason: null;
        label: null;
        queueDepth: number;
        totalNotionalX18: bigint;
        side0X18: bigint;
        side1X18: bigint;
        imbalanceBps: number | null;
        dexSpreadOk: boolean;
      };
    };
    unsafe.lastDecision = {
      reason: null,
      label: null,
      queueDepth: 0,
      totalNotionalX18: 30_000000000000000000n,
      side0X18: 20_000000000000000000n,
      side1X18: 10_000000000000000000n,
      imbalanceBps: 3333,
      dexSpreadOk: true,
    };

    const status = agent.getStatus();

    assert.deepEqual(status.decision, {
      side0X18: "20000000000000000000",
      side1X18: "10000000000000000000",
      imbalanceBps: 3333,
      dexSpreadOk: true,
    });
    assert.deepEqual(status.config, {
      imbalanceBps: 1500,
      maxIntervalSeconds: 60,
      dexSpreadBps: 500,
      maxClearingDeviationBps: 1000,
    });
  });
});
