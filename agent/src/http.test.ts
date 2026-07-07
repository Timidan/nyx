import { once } from "node:events";
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { startHttpServer } from "./http.js";
import type { NyxAgent } from "./agent.js";
import type { AgentConfig } from "./config.js";

let server: Server | null = null;

const baseConfig: AgentConfig = {
  rpcUrl: "http://127.0.0.1:8545",
  chainId: 968,
  auctionAddress: "0x0000000000000000000000000000000000000100",
  wbot: "0x0000000000000000000000000000000000000001",
  bousdt: "0x0000000000000000000000000000000000000002",
  dexPair: "0x0000000000000000000000000000000000000003",
  fromBlock: 0n,
  pollMs: 5000,
  httpHost: "127.0.0.1",
  httpPort: 0,
  corsOrigin: "http://localhost:5190",
  apiBearerToken: "secret-token",
  requireApiBearerToken: true,
  rateLimitWindowMs: 60_000,
  rateLimitMaxRequests: 1,
  storePath: "/tmp/nyx-agent-http-test.json",
  depthMin: 4,
  imbalanceBps: 1500,
  notionalMaxX18: 1_000000000000000000n,
  maxIntervalSeconds: 60,
  dexSpreadBps: 500,
  maxClearingDeviationBps: 1000,
  dryRun: false,
};

const fakeAgent = {
  health: async () => ({ ok: true }),
  getStatus: () => ({ agentState: "watching" }),
  submitOrder: async () => ({
    commitment: "0x0000000000000000000000000000000000000000000000000000000000000001",
    status: "queued",
  }),
} as unknown as NyxAgent;

afterEach(async () => {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server?.close((error) => (error ? reject(error) : resolve()));
  });
  server = null;
});

describe("agent HTTP boundary", () => {
  it("requires bearer auth before accepting reveals", async () => {
    const baseUrl = await startTestServer(baseConfig);
    const response = await fetch(`${baseUrl}/orders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validOrderReveal()),
    });

    assert.equal(response.status, 401);
  });

  it("rate-limits accepted reveal submissions", async () => {
    const baseUrl = await startTestServer(baseConfig);
    const first = await postOrder(baseUrl);
    const second = await postOrder(baseUrl);

    assert.equal(first.status, 202);
    assert.equal(second.status, 429);
  });
});

async function startTestServer(config: AgentConfig): Promise<string> {
  server = startHttpServer(fakeAgent, config);
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  return `http://127.0.0.1:${address.port}`;
}

function postOrder(baseUrl: string): Promise<Response> {
  return fetch(`${baseUrl}/orders`, {
    method: "POST",
    headers: {
      authorization: "Bearer secret-token",
      "content-type": "application/json",
    },
    body: JSON.stringify(validOrderReveal()),
  });
}

function validOrderReveal() {
  return {
    trader: "0x0000000000000000000000000000000000000011",
    batchId: "1",
    sellToken: "0x0000000000000000000000000000000000000001",
    sellAmount: "1000000000000000000",
    minBuyAmount: "1",
    salt: "0x0000000000000000000000000000000000000000000000000000000000000002",
  };
}
