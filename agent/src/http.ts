import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { getAddress, isAddress, isHex } from "viem";
import type { NyxAgent } from "./agent.js";
import type { AgentConfig } from "./config.js";
import type { OrderReveal } from "./types.js";

export function startHttpServer(agent: NyxAgent, config: AgentConfig) {
  const orderLimiter = new FixedWindowRateLimiter(
    config.rateLimitWindowMs,
    config.rateLimitMaxRequests,
  );

  const server = createServer(async (req, res) => {
    setSecurityHeaders(res);
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
        if (rejectBadBrowserOrigin(req, res, config.corsOrigin)) return;
        if (rejectUnauthenticated(req, res, config)) return;
        if (rejectRateLimited(req, res, orderLimiter)) return;
        requireJsonContentType(req);
        const body = await readJson(req);
        const order = parseOrderReveal(body);
        return sendJson(res, 202, await agent.submitOrder(order));
      }

      sendJson(res, 404, { error: "not found" });
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 400;
      sendJson(res, status, { error: (error as Error).message });
    }
  });

  server.listen(config.httpPort, config.httpHost, () => {
    console.log(`Nyx agent HTTP API listening on http://${config.httpHost}:${config.httpPort}`);
  });
  return server;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly windowMs: number,
    private readonly maxRequests: number,
  ) {}

  take(key: string): { ok: true } | { ok: false; retryAfterSeconds: number } {
    if (this.maxRequests <= 0) return { ok: true };
    const now = Date.now();
    const current = this.buckets.get(key);
    const bucket =
      current && current.resetAt > now ? current : { count: 0, resetAt: now + this.windowMs };
    bucket.count += 1;
    this.buckets.set(key, bucket);

    if (bucket.count <= this.maxRequests) return { ok: true };
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }
}

function setSecurityHeaders(res: ServerResponse): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  res.setHeader("Cache-Control", "no-store");
}

function setCors(res: ServerResponse, origin: string): void {
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "authorization,content-type");
}

function rejectBadBrowserOrigin(
  req: IncomingMessage,
  res: ServerResponse,
  allowedOrigin: string,
): boolean {
  const origin = req.headers.origin;
  if (origin == null) return false;
  if (origin === allowedOrigin) return false;
  sendJson(res, 403, { error: "origin not allowed" });
  return true;
}

function rejectUnauthenticated(
  req: IncomingMessage,
  res: ServerResponse,
  config: AgentConfig,
): boolean {
  if (!config.requireApiBearerToken) return false;
  const expected = config.apiBearerToken;
  const provided = parseBearerToken(req.headers.authorization);
  if (expected && provided && constantTimeEqual(provided, expected)) return false;
  sendJson(res, 401, { error: "unauthorized" });
  return true;
}

function rejectRateLimited(
  req: IncomingMessage,
  res: ServerResponse,
  limiter: FixedWindowRateLimiter,
): boolean {
  const result = limiter.take(req.socket.remoteAddress ?? "unknown");
  if (result.ok) return false;
  res.setHeader("Retry-After", String(result.retryAfterSeconds));
  sendJson(res, 429, { error: "rate limit exceeded" });
  return true;
}

function requireJsonContentType(req: IncomingMessage): void {
  const contentType = req.headers["content-type"];
  if (typeof contentType !== "string" || !contentType.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "content-type must be application/json");
  }
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
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "request body must be valid JSON");
  }
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

function parseBearerToken(value: string | undefined): string | null {
  if (!value) return null;
  const [scheme, token] = value.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
