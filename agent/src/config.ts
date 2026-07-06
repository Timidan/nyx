import { existsSync } from "node:fs";
import { resolve } from "node:path";
import dotenv from "dotenv";
import { getAddress, isAddress, isHex } from "viem";
import type { Address } from "./types.js";

for (const path of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../.env")]) {
  if (existsSync(path)) dotenv.config({ path, override: false });
}

export interface AgentConfig {
  rpcUrl: string;
  chainId: number;
  auctionAddress?: Address;
  wbot: Address;
  bousdt: Address;
  dexPair: Address;
  swapRouter?: Address;
  expectedAgent?: Address;
  fromBlock: bigint;
  pollMs: number;
  httpPort: number;
  corsOrigin: string;
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
  return {
    rpcUrl: required("RPC_URL"),
    chainId: Number(env("CHAIN_ID", "968")),
    auctionAddress: optionalAddress("NYX_BATCH_AUCTION"),
    wbot: requiredAddress("WBOT"),
    bousdt: requiredAddress("BOUSDT"),
    dexPair: requiredAddress("BOT_DEX_PAIR"),
    swapRouter: optionalAddress("SWAP_ROUTER"),
    expectedAgent: optionalAddress("AGENT_ADDRESS"),
    fromBlock: BigInt(env("START_BLOCK", "0")),
    pollMs: Number(env("AGENT_POLL_MS", "5000")),
    httpPort: Number(env("AGENT_PORT", "8787")),
    corsOrigin: env("CORS_ORIGIN", "http://localhost:5173"),
    storePath: env("ORDER_STORE_PATH", resolve(process.cwd(), ".data/orders.json")),
    depthMin: Number(env("DEPTH_MIN", "4")),
    imbalanceBps: Number(env("IMBALANCE_BPS", "1500")),
    notionalMaxX18: BigInt(env("NOTIONAL_MAX_X18", "1000000000000000000")),
    maxIntervalSeconds: Number(env("MAX_INTERVAL_SECONDS", "60")),
    dexSpreadBps: Number(env("DEX_SPREAD_BPS", "500")),
    maxClearingDeviationBps: Number(env("MAX_CLEARING_DEVIATION_BPS", "1000")),
    dryRun: overrides.dryRun ?? env("DRY_RUN", "false") === "true",
  };
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
