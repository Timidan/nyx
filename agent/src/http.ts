import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { getAddress, isAddress, isHex } from "viem";
import type { NyxAgent } from "./agent.js";
import type { AgentConfig } from "./config.js";
import type { OrderReveal } from "./types.js";

export function startHttpServer(agent: NyxAgent, config: AgentConfig) {
  const server = createServer(async (req, res) => {
    setCors(res, config.corsOrigin);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      if (req.method === "GET" && req.url === "/health") {
        return sendJson(res, 200, await agent.health());
      }
      if (req.method === "GET" && req.url === "/status") {
        return sendJson(res, 200, agent.getStatus());
      }
      if (req.method === "POST" && req.url === "/orders") {
        const body = await readJson(req);
        const order = parseOrderReveal(body);
        return sendJson(res, 202, await agent.submitOrder(order));
      }

      sendJson(res, 404, { error: "not found" });
    } catch (error) {
      sendJson(res, 400, { error: (error as Error).message });
    }
  });

  server.listen(config.httpPort, () => {
    console.log(`Nyx agent HTTP API listening on http://localhost:${config.httpPort}`);
  });
  return server;
}

function setCors(res: ServerResponse, origin: string): void {
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body, bigintReplacer, 2));
}

function bigintReplacer(_key: string, value: unknown) {
  return typeof value === "bigint" ? value.toString() : value;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 64 * 1024) throw new Error("request body too large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function parseOrderReveal(value: unknown): OrderReveal {
  if (!isRecord(value)) throw new Error("body must be an OrderReveal object");
  const trader = parseAddress(value.trader, "trader");
  const sellToken = parseAddress(value.sellToken, "sellToken");
  const salt = parseBytes32(value.salt, "salt");
  return {
    trader,
    batchId: parseBigInt(value.batchId, "batchId"),
    sellToken,
    sellAmount: parseBigInt(value.sellAmount, "sellAmount"),
    minBuyAmount: parseBigInt(value.minBuyAmount, "minBuyAmount"),
    salt,
  };
}

function parseAddress(value: unknown, field: string): `0x${string}` {
  if (typeof value !== "string" || !isAddress(value)) throw new Error(`${field} must be an address`);
  return getAddress(value);
}

function parseBytes32(value: unknown, field: string): `0x${string}` {
  if (typeof value !== "string" || !isHex(value) || value.length !== 66) {
    throw new Error(`${field} must be bytes32 hex`);
  }
  return value as `0x${string}`;
}

function parseBigInt(value: unknown, field: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && /^[0-9]+$/.test(value)) return BigInt(value);
  throw new Error(`${field} must be a non-negative integer string`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
