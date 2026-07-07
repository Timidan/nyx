import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { erc20Abi, nyxBatchAuctionAbi, pairAbi } from "./abi.js";
import { toX18 } from "./math.js";
import type { AgentConfig } from "./config.js";
import type { Address, DexSnapshot, Hex32, MatchedOrder, OrderReveal, TokenInfo } from "./types.js";

export function makeChain(config: AgentConfig) {
  return defineChain({
    id: config.chainId,
    name: "BOT Chain",
    nativeCurrency: { name: "BOT", symbol: "BOT", decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl] } },
  });
}

export function makePublicClient(config: AgentConfig): PublicClient {
  return createPublicClient({ chain: makeChain(config), transport: http(config.rpcUrl) });
}

export function makeWalletClient(config: AgentConfig, privateKey: `0x${string}`): {
  account: PrivateKeyAccount;
  walletClient: WalletClient;
} {
  const account = privateKeyToAccount(privateKey);
  return {
    account,
    walletClient: createWalletClient({
      account,
      chain: makeChain(config),
      transport: http(config.rpcUrl),
    }),
  };
}

export async function readDexSnapshot(
  publicClient: PublicClient,
  config: AgentConfig,
): Promise<DexSnapshot> {
  const [pairToken0, pairToken1, reserves, wbotInfo, bousdtInfo] = await Promise.all([
    publicClient.readContract({ address: config.dexPair, abi: pairAbi, functionName: "token0" }),
    publicClient.readContract({ address: config.dexPair, abi: pairAbi, functionName: "token1" }),
    publicClient.readContract({ address: config.dexPair, abi: pairAbi, functionName: "getReserves" }),
    readTokenInfo(publicClient, config.wbot),
    readTokenInfo(publicClient, config.bousdt),
  ]);

  const [reserve0, reserve1] = reserves;
  const wbotReserve = sameAddress(pairToken0, config.wbot) ? reserve0 : reserve1;
  const bousdtReserve = sameAddress(pairToken0, config.bousdt) ? reserve0 : reserve1;
  const wbotX18 = toX18(wbotReserve, wbotInfo.decimals);
  const bousdtX18 = toX18(bousdtReserve, bousdtInfo.decimals);
  if (wbotX18 === 0n || bousdtX18 === 0n) {
    throw new Error("BOT DEX reference pair has zero reserve");
  }

  return {
    pair: config.dexPair,
    pairToken0: getAddress(pairToken0),
    pairToken1: getAddress(pairToken1),
    reserve0,
    reserve1,
    token0: wbotInfo,
    token1: bousdtInfo,
    referencePriceX18: (bousdtX18 * 1_000000000000000000n) / wbotX18,
  };
}

export async function readAuctionSnapshot(
  publicClient: PublicClient,
  config: AgentConfig,
): Promise<{ currentBatchId: bigint | null; referencePriceX18: bigint | null }> {
  if (!config.auctionAddress) {
    return { currentBatchId: null, referencePriceX18: null };
  }

  const [currentBatchId, referencePriceX18] = await Promise.all([
    publicClient.readContract({
      address: config.auctionAddress,
      abi: nyxBatchAuctionAbi,
      functionName: "currentBatchId",
    }),
    publicClient.readContract({
      address: config.auctionAddress,
      abi: nyxBatchAuctionAbi,
      functionName: "getReferencePriceX18",
    }),
  ]);
  return { currentBatchId, referencePriceX18 };
}

export async function hashOrder(
  publicClient: PublicClient,
  auctionAddress: Address,
  order: OrderReveal,
): Promise<Hex32> {
  return (await publicClient.readContract({
    address: auctionAddress,
    abi: nyxBatchAuctionAbi,
    functionName: "hashOrder",
    args: [order],
  })) as Hex32;
}

export async function readOrder(
  publicClient: PublicClient,
  auctionAddress: Address,
  commitment: Hex32,
): Promise<{
  trader: Address;
  batchId: bigint;
  sellToken: Address;
  sellAmount: bigint;
  submittedAt: bigint;
  status: number;
}> {
  const [trader, batchId, sellToken, sellAmount, submittedAt, status] =
    (await publicClient.readContract({
      address: auctionAddress,
      abi: nyxBatchAuctionAbi,
      functionName: "getOrder",
      args: [commitment],
    })) as [Address, bigint, Address, bigint, bigint, number];

  return {
    trader: getAddress(trader),
    batchId,
    sellToken: getAddress(sellToken),
    sellAmount,
    submittedAt,
    status: Number(status),
  };
}

export async function readSubmittedStatuses(
  publicClient: PublicClient,
  config: AgentConfig,
): Promise<Map<Hex32, "queued" | "settled" | "cancelled">> {
  const statuses = new Map<Hex32, "queued" | "settled" | "cancelled">();
  if (!config.auctionAddress) return statuses;

  const [submitted, settled, cancelled] = await Promise.all([
    publicClient.getContractEvents({
      address: config.auctionAddress,
      abi: nyxBatchAuctionAbi,
      eventName: "OrderSubmitted",
      fromBlock: config.fromBlock,
      toBlock: "latest",
    }),
    publicClient.getContractEvents({
      address: config.auctionAddress,
      abi: nyxBatchAuctionAbi,
      eventName: "OrderSettled",
      fromBlock: config.fromBlock,
      toBlock: "latest",
    }),
    publicClient.getContractEvents({
      address: config.auctionAddress,
      abi: nyxBatchAuctionAbi,
      eventName: "OrderCancelled",
      fromBlock: config.fromBlock,
      toBlock: "latest",
    }),
  ]);

  for (const log of submitted) {
    statuses.set(log.args.commitment as Hex32, "queued");
  }
  for (const log of settled) {
    statuses.set(log.args.commitment as Hex32, "settled");
  }
  for (const log of cancelled) {
    statuses.set(log.args.commitment as Hex32, "cancelled");
  }
  return statuses;
}

export async function readLatestBatchSettledReason(
  publicClient: PublicClient,
  config: AgentConfig,
): Promise<number | null> {
  if (!config.auctionAddress) return null;

  const settled = await publicClient.getContractEvents({
    address: config.auctionAddress,
    abi: nyxBatchAuctionAbi,
    eventName: "BatchSettled",
    fromBlock: config.fromBlock,
    toBlock: "latest",
  });

  const latest = settled.reduce<(typeof settled)[number] | null>((best, log) => {
    if (!best) return log;
    const bestBlock = best.blockNumber ?? 0n;
    const logBlock = log.blockNumber ?? 0n;
    if (logBlock > bestBlock) return log;
    if (logBlock < bestBlock) return best;
    return BigInt(log.logIndex ?? 0) > BigInt(best.logIndex ?? 0) ? log : best;
  }, null);

  return latest?.args.reason == null ? null : Number(latest.args.reason);
}

export async function simulateSettle(
  publicClient: PublicClient,
  config: AgentConfig,
  account: PrivateKeyAccount,
  batchId: bigint,
  clearingPriceX18: bigint,
  reason: number,
  orders: MatchedOrder[],
) {
  if (!config.auctionAddress) throw new Error("NYX_BATCH_AUCTION is not configured");
  return publicClient.simulateContract({
    account,
    address: config.auctionAddress,
    abi: nyxBatchAuctionAbi,
    functionName: "settleBatch",
    args: [batchId, clearingPriceX18, reason, orders],
  });
}

export async function sendSettleWithGasBump(
  publicClient: PublicClient,
  walletClient: WalletClient,
  request: Parameters<WalletClient["writeContract"]>[0],
  maxRetries: number,
): Promise<Hex32> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const gas = await publicClient.estimateContractGas(request as never);
      const multiplier = 100n + BigInt(attempt * 25);
      return (await walletClient.writeContract({
        ...request,
        gas: (gas * multiplier) / 100n,
      } as never)) as Hex32;
    } catch (error) {
      lastError = error;
      await sleep(750 * (attempt + 1));
    }
  }
  throw lastError;
}

async function readTokenInfo(publicClient: PublicClient, address: Address): Promise<TokenInfo> {
  const [symbol, decimals] = await Promise.all([
    publicClient.readContract({ address, abi: erc20Abi, functionName: "symbol" }),
    publicClient.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
  ]);
  return { address, symbol, decimals };
}

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
