import { existsSync } from "node:fs";
import { resolve } from "node:path";
import dotenv from "dotenv";
import { getAddress, isAddress, isHex } from "viem";
import type { Address, Hex32 } from "./types.js";

for (const path of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../.env")]) {
  if (existsSync(path)) dotenv.config({ path, override: false });
}

export interface AgentConfig {
  rpcUrl: string;
  chainId: number;
  auctionAddress?: Address;
  wbot: Address;
  bousdt: Address;
  referenceOracle?: Address;
  v3Pool?: Address;
  v3Factory?: Address;
  expectedAgent?: Address;
  expectedAuctionCodeHash?: Hex32;
  fromBlock: bigint;
  pollMs: number;
  httpHost: string;
  httpPort: number;
  corsOrigin: string;
  apiBearerToken?: string;
  quoteProviderBearerToken?: string;
  requireApiBearerToken: boolean;
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
  storePath: string;
  depthMin: number;
  imbalanceBps: number;
  notionalMaxX18: bigint;
  maxIntervalSeconds: number;
  dexSpreadBps: number;
  maxClearingDeviationBps: number;
  dryRun: boolean;
}

export function loadConfig(overrides: { dryRun?: boolean } = {}): AgentConfig {
  const requireApiBearerToken =
    env("AGENT_REQUIRE_API_BEARER_TOKEN", process.env.NODE_ENV === "production" ? "true" : "false")
      === "true";
  const apiBearerToken = process.env.AGENT_API_BEARER_TOKEN;
  if (requireApiBearerToken && !apiBearerToken) {
    throw new Error("AGENT_API_BEARER_TOKEN is required when bearer-token enforcement is enabled");
  }

  const config: AgentConfig = {
    rpcUrl: required("RPC_URL"),
    chainId: Number(env("CHAIN_ID", "968")),
    auctionAddress: optionalAddress("NYX_BATCH_AUCTION"),
    wbot: requiredAddress("WBOT"),
    bousdt: requiredAddress("BOUSDT"),
    referenceOracle: optionalAddress("REFERENCE_ORACLE"),
    v3Pool: optionalAddress("BOT_V3_POOL"),
    v3Factory: optionalAddress("BOT_V3_FACTORY"),
    expectedAgent: optionalAddress("AGENT_ADDRESS"),
    expectedAuctionCodeHash: optionalBytes32("AUCTION_RUNTIME_CODE_HASH"),
    fromBlock: BigInt(env("START_BLOCK", "0")),
    pollMs: Number(env("AGENT_POLL_MS", "5000")),
    httpHost: env("AGENT_HOST", "127.0.0.1"),
    httpPort: Number(env("AGENT_PORT", "8787")),
    corsOrigin: env("CORS_ORIGIN", "http://localhost:5190"),
    apiBearerToken,
    quoteProviderBearerToken: process.env.QUOTE_PROVIDER_BEARER_TOKEN,
    requireApiBearerToken,
    rateLimitWindowMs: Number(env("AGENT_RATE_LIMIT_WINDOW_MS", "60000")),
    rateLimitMaxRequests: Number(env("AGENT_RATE_LIMIT_MAX_REQUESTS", "60")),
    storePath: env("ORDER_STORE_PATH", resolve(process.cwd(), ".data/orders.json")),
    depthMin: Number(env("DEPTH_MIN", "4")),
    imbalanceBps: Number(env("IMBALANCE_BPS", "1500")),
    notionalMaxX18: BigInt(env("NOTIONAL_MAX_X18", "1000000000000000000")),
    maxIntervalSeconds: Number(env("MAX_INTERVAL_SECONDS", "60")),
    dexSpreadBps: Number(env("DEX_SPREAD_BPS", "500")),
    maxClearingDeviationBps: Number(env("MAX_CLEARING_DEVIATION_BPS", "1000")),
    dryRun: overrides.dryRun ?? env("DRY_RUN", "false") === "true",
  };
  return validateAgentConfig(config);
}

export function validateAgentConfig(config: AgentConfig): AgentConfig {
  requireInteger("chainId", config.chainId, 1);
  if (config.fromBlock < 0n) throw new Error("START_BLOCK must not be negative");
  requireInteger("pollMs", config.pollMs, 1);
  requireInteger("httpPort", config.httpPort, 1, 65_535);
  requireInteger("rateLimitWindowMs", config.rateLimitWindowMs, 1);
  requireInteger("rateLimitMaxRequests", config.rateLimitMaxRequests, 1);
  requireInteger("depthMin", config.depthMin, 2);
  requireInteger("imbalanceBps", config.imbalanceBps, 0, 10_000);
  if (config.notionalMaxX18 <= 0n) throw new Error("notionalMaxX18 must be positive");
  requireInteger("maxIntervalSeconds", config.maxIntervalSeconds, 1);
  requireInteger("dexSpreadBps", config.dexSpreadBps, 0, 10_000);
  requireInteger("maxClearingDeviationBps", config.maxClearingDeviationBps, 0, 2_000);
  requireHttpUrl("RPC_URL", config.rpcUrl);
  requireHttpUrl("CORS_ORIGIN", config.corsOrigin);
  if (!config.httpHost) throw new Error("AGENT_HOST must not be empty");
  if (!config.storePath) throw new Error("ORDER_STORE_PATH must not be empty");
  return config;
}

export function readAgentPrivateKey(): `0x${string}` | undefined {
  const key = process.env.AGENT_PRIVATE_KEY;
  if (!key) return undefined;
  const normalized = key.startsWith("0x") ? key : `0x${key}`;
  if (!isHex(normalized) || normalized.length !== 66) {
    throw new Error("AGENT_PRIVATE_KEY must be a 32-byte hex private key");
  }
  return normalized as `0x${string}`;
}

function env(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function requiredAddress(name: string): Address {
  const value = required(name);
  if (!isAddress(value)) throw new Error(`${name} must be an EVM address`);
  return getAddress(value);
}

function optionalAddress(name: string): Address | undefined {
  const value = process.env[name];
  if (!value) return undefined;
  if (!isAddress(value)) throw new Error(`${name} must be an EVM address`);
  return getAddress(value);
}

function optionalBytes32(name: string): Hex32 | undefined {
  const value = process.env[name];
  if (!value) return undefined;
  if (!isHex(value) || value.length !== 66) throw new Error(`${name} must be bytes32 hex`);
  return value.toLowerCase() as Hex32;
}

function requireInteger(name: string, value: number, min: number, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
}

function requireHttpUrl(name: string, value: string): void {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
  } catch {
    throw new Error(`${name} must be an http(s) URL`);
  }
}
