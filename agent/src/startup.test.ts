import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateStartupState, type StartupState } from "./startup.js";
import type { AgentConfig } from "./config.js";

const auction = "0x0000000000000000000000000000000000000100";
const base = "0x0000000000000000000000000000000000000001";
const quote = "0x0000000000000000000000000000000000000002";
const oracle = "0x0000000000000000000000000000000000000003";
const pool = "0x0000000000000000000000000000000000000004";
const factory = "0x0000000000000000000000000000000000000006";
const agent = "0x0000000000000000000000000000000000000005";
const codeHash = `0x${"ab".repeat(32)}` as const;

const config = {
  rpcUrl: "http://127.0.0.1:8545",
  chainId: 677,
  auctionAddress: auction,
  wbot: base,
  bousdt: quote,
  referenceOracle: oracle,
  v3Pool: pool,
  v3Factory: factory,
  expectedAgent: agent,
  expectedAuctionCodeHash: codeHash,
  fromBlock: 123n,
  pollMs: 5000,
  httpHost: "127.0.0.1",
  httpPort: 8787,
  corsOrigin: "https://nyx.example",
  requireApiBearerToken: true,
  rateLimitWindowMs: 60_000,
  rateLimitMaxRequests: 60,
  storePath: "/tmp/nyx-startup-test.json",
  depthMin: 4,
  imbalanceBps: 1500,
  notionalMaxX18: 1_000000000000000000n,
  maxIntervalSeconds: 60,
  dexSpreadBps: 500,
  maxClearingDeviationBps: 1000,
  dryRun: false,
} as AgentConfig;

const state: StartupState = {
  chainId: 677,
  latestBlock: 1_000n,
  auctionCodeHash: codeHash,
  token0: base,
  token1: quote,
  referenceOracle: oracle,
  oracleBaseToken: base,
  oracleQuoteToken: quote,
  oraclePool: pool,
  oracleFactory: factory,
  contractAgent: agent,
  signer: agent,
  paused: true,
};

describe("validateStartupState", () => {
  it("accepts an exact deployment and signer match", () => {
    assert.doesNotThrow(() => validateStartupState(config, state));
  });

  it("ignores the oracle factory off mainnet until BOT_V3_FACTORY pins one", () => {
    const testnet = { ...config, chainId: 968, v3Factory: undefined } as AgentConfig;
    assert.doesNotThrow(() =>
      validateStartupState(testnet, { ...state, chainId: 968, oracleFactory: undefined })
    );
  });

  it("requires BOT_V3_FACTORY on mainnet even when the oracle answers", () => {
    const unpinned = { ...config, v3Factory: undefined } as AgentConfig;
    assert.throws(
      () => validateStartupState(unpinned, state),
      /BOT_V3_FACTORY is required on mainnet/i,
    );
  });

  it("rejects an oracle bound to an unexpected factory", () => {
    assert.throws(
      () =>
        validateStartupState(config, {
          ...state,
          oracleFactory: "0x00000000000000000000000000000000000000ff",
        }),
      /oracle factory mismatch/i,
    );
  });

  it("rejects an oracle that predates the factory binding once one is pinned", () => {
    assert.throws(
      () => validateStartupState(config, { ...state, oracleFactory: undefined }),
      /predates the canonical pool binding/i,
    );
  });

  it("rejects a chain mismatch", () => {
    assert.throws(
      () => validateStartupState(config, { ...state, chainId: 968 }),
      /chain id mismatch/i,
    );
  });

  it("rejects the wrong auction runtime", () => {
    assert.throws(
      () => validateStartupState(config, { ...state, auctionCodeHash: `0x${"cd".repeat(32)}` }),
      /code hash mismatch/i,
    );
  });

  it("rejects token, oracle, pool, authority, and signer mismatches", () => {
    const wrong = "0x00000000000000000000000000000000000000ff";
    for (const [field, expectedMessage] of [
      ["token0", /token0 mismatch/i],
      ["token1", /token1 mismatch/i],
      ["referenceOracle", /reference oracle mismatch/i],
      ["oracleBaseToken", /oracle base token mismatch/i],
      ["oracleQuoteToken", /oracle quote token mismatch/i],
      ["oraclePool", /oracle pool mismatch/i],
      ["contractAgent", /contract agent mismatch/i],
      ["signer", /signer does not control/i],
    ] as const) {
      assert.throws(
        () => validateStartupState(config, { ...state, [field]: wrong }),
        expectedMessage,
      );
    }
  });

  it("rejects an unset or future deployment block", () => {
    assert.throws(
      () => validateStartupState({ ...config, fromBlock: 0n }, state),
      /START_BLOCK must be the deployment block/i,
    );
    assert.throws(
      () => validateStartupState({ ...config, fromBlock: 1_001n }, state),
      /after the latest block/i,
    );
  });
});
