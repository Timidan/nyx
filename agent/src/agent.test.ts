import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NyxAgent, SIMULATION_FAILURES_BEFORE_QUARANTINE } from "./agent.js";
import type { AgentConfig } from "./config.js";

const config: AgentConfig = {
  rpcUrl: "http://127.0.0.1:8545",
  chainId: 968,
  auctionAddress: "0x0000000000000000000000000000000000000100",
  wbot: "0x0000000000000000000000000000000000000001",
  bousdt: "0x0000000000000000000000000000000000000002",
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

  it("never overlaps polling cycles when one cycle is still running", async () => {
    const agent = new NyxAgent({ ...config, pollMs: 1 });
    const unsafe = agent as unknown as {
      runOnce: () => Promise<unknown>;
    };
    let scheduled: (() => void) | undefined;
    const originalSetInterval = globalThis.setInterval;
    let calls = 0;
    let active = 0;
    let maxActive = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    unsafe.runOnce = async () => {
      calls += 1;
      if (calls === 1) return null;
      active += 1;
      maxActive = Math.max(maxActive, active);
      await gate;
      active -= 1;
      return null;
    };
    globalThis.setInterval = (((handler: TimerHandler) => {
      scheduled = handler as () => void;
      return 1 as unknown as ReturnType<typeof setInterval>;
    }) as unknown) as typeof setInterval;

    try {
      await agent.startLoop();
      assert.ok(scheduled);
      scheduled();
      scheduled();
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(maxActive, 1);
    } finally {
      release?.();
      globalThis.setInterval = originalSetInterval;
    }
  });

  it("waits without quarantining candidates while the auction is paused", async () => {
    const agent = new NyxAgent(config);
    const unsafe = agent as unknown as {
      auctionPaused: boolean;
      act: (decision: unknown, queue: unknown[]) => Promise<void>;
    };
    unsafe.auctionPaused = true;

    await unsafe.act(
      {
        reason: 0,
        label: "depth",
        queueDepth: 2,
        totalNotionalX18: 1n,
        side0X18: 1n,
        side1X18: 1n,
        imbalanceBps: 0,
        dexSpreadOk: false,
      },
      [],
    );

    assert.equal(agent.getStatus().agentState, "paused: waiting for owner");
  });
});

describe("simulation failure handling", () => {
  it("retries a candidate set before setting it aside", () => {
    const agent = new NyxAgent(config);
    const unsafe = agent as unknown as {
      recordSimulationFailure: (key: string, reason: string) => number;
    };

    assert.equal(unsafe.recordSimulationFailure("a|b", "oracle deviation"), 1);
    assert.equal(unsafe.recordSimulationFailure("a|b", "oracle deviation"), 2);
    assert.equal(unsafe.recordSimulationFailure("a|b", "oracle deviation"), 3);
    assert.equal(SIMULATION_FAILURES_BEFORE_QUARANTINE, 3);
  });

  it("restarts the count when the failure changes or the set changes", () => {
    const agent = new NyxAgent(config);
    const unsafe = agent as unknown as {
      recordSimulationFailure: (key: string, reason: string) => number;
    };

    assert.equal(unsafe.recordSimulationFailure("a|b", "rpc timeout"), 1);
    assert.equal(unsafe.recordSimulationFailure("a|b", "rpc timeout"), 2);
    assert.equal(unsafe.recordSimulationFailure("a|b", "oracle deviation"), 1);
    assert.equal(unsafe.recordSimulationFailure("c|d", "oracle deviation"), 1);
  });
});
