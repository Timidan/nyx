import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  keccak256,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { erc20Abi, nyxBatchAuctionAbi, nyxPriceOracleAbi } from "./abi.js";
import type { AgentConfig } from "./config.js";
import type { Address, Hex32, MarketSnapshot, MatchedOrder, OrderReveal, TokenInfo } from "./types.js";
import type { StartupState } from "./startup.js";

const MAX_RPC_LOG_BLOCK_RANGE = 5_000n;
const LOG_SCAN_CONCURRENCY = 8;

type AuctionEventLog = {
  args: { commitment?: Hex32; reason?: bigint | number };
  blockNumber: bigint | null;
  logIndex: number | null;
};

export interface LatestBatchSettlement {
  reason: number;
  blockNumber: bigint;
  timestamp: number;
}

export function splitBlockRange(
  fromBlock: bigint,
  toBlock: bigint,
  maxRange = MAX_RPC_LOG_BLOCK_RANGE,
): Array<{ fromBlock: bigint; toBlock: bigint }> {
  if (maxRange <= 0n) throw new RangeError("maxRange must be positive");
  if (fromBlock > toBlock) return [];

  const ranges: Array<{ fromBlock: bigint; toBlock: bigint }> = [];
  for (let start = fromBlock; start <= toBlock; start += maxRange) {
    const end = start + maxRange - 1n;
    ranges.push({ fromBlock: start, toBlock: end < toBlock ? end : toBlock });
  }
  return ranges;
}

export function assertSuccessfulReceipt(receipt: { status: string }): void {
  if (receipt.status !== "success") {
    throw new Error("settlement transaction reverted on-chain");
  }
}

export function selectLatestSettlementLog(logs: AuctionEventLog[]): AuctionEventLog | null {
  return logs.reduce<AuctionEventLog | null>((best, log) => {
    if (!best) return log;
    const bestBlock = best.blockNumber ?? 0n;
    const logBlock = log.blockNumber ?? 0n;
    if (logBlock > bestBlock) return log;
    if (logBlock < bestBlock) return best;
    return BigInt(log.logIndex ?? 0) > BigInt(best.logIndex ?? 0) ? log : best;
  }, null);
}

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

export async function readStartupState(
  publicClient: PublicClient,
  config: AgentConfig,
  signer?: Address,
): Promise<StartupState> {
  if (!config.auctionAddress) throw new Error("NYX_BATCH_AUCTION is required");
  const [chainId, latestBlock, bytecode, token0, token1, referenceOracle, contractAgent, paused] =
    await Promise.all([
      publicClient.getChainId(),
      publicClient.getBlockNumber(),
      publicClient.getBytecode({ address: config.auctionAddress }),
      publicClient.readContract({
        address: config.auctionAddress,
        abi: nyxBatchAuctionAbi,
        functionName: "token0",
      }),
      publicClient.readContract({
        address: config.auctionAddress,
        abi: nyxBatchAuctionAbi,
        functionName: "token1",
      }),
      publicClient.readContract({
        address: config.auctionAddress,
        abi: nyxBatchAuctionAbi,
        functionName: "referenceOracle",
      }),
      publicClient.readContract({
        address: config.auctionAddress,
        abi: nyxBatchAuctionAbi,
        functionName: "agent",
      }),
      publicClient.readContract({
        address: config.auctionAddress,
        abi: nyxBatchAuctionAbi,
        functionName: "paused",
      }),
    ]);
  if (!bytecode || bytecode === "0x") throw new Error("auction has no runtime bytecode");

  const oracleAddress = getAddress(referenceOracle);
  const [oracleBaseToken, oracleQuoteToken, oraclePool, oracleFactory] = await Promise.all([
    publicClient.readContract({
      address: oracleAddress,
      abi: nyxPriceOracleAbi,
      functionName: "baseToken",
    }),
    publicClient.readContract({
      address: oracleAddress,
      abi: nyxPriceOracleAbi,
      functionName: "quoteToken",
    }),
    publicClient.readContract({
      address: oracleAddress,
      abi: nyxPriceOracleAbi,
      functionName: "pool",
    }),
    // Oracles deployed before the canonical pool binding have no factory().
    // Startup validation decides whether an absent answer is fatal.
    publicClient
      .readContract({ address: oracleAddress, abi: nyxPriceOracleAbi, functionName: "factory" })
      .catch(() => undefined),
  ]);

  return {
    chainId,
    latestBlock,
    auctionCodeHash: keccak256(bytecode),
    token0: getAddress(token0),
    token1: getAddress(token1),
    referenceOracle: oracleAddress,
    oracleBaseToken: getAddress(oracleBaseToken),
    oracleQuoteToken: getAddress(oracleQuoteToken),
    oraclePool: getAddress(oraclePool),
    oracleFactory: oracleFactory ? getAddress(oracleFactory) : undefined,
    contractAgent: getAddress(contractAgent),
    signer,
    paused,
  };
}

export async function readMarketSnapshot(
  publicClient: PublicClient,
  config: AgentConfig,
  referencePriceX18: bigint,
): Promise<MarketSnapshot> {
  const [wbotInfo, bousdtInfo] = await Promise.all([
    readTokenInfo(publicClient, config.wbot),
    readTokenInfo(publicClient, config.bousdt),
  ]);
  return {
    token0: wbotInfo,
    token1: bousdtInfo,
    referencePriceX18,
  };
}

export async function readAuctionSnapshot(
  publicClient: PublicClient,
  config: AgentConfig,
): Promise<{
  currentBatchId: bigint | null;
  referencePriceX18: bigint | null;
  paused: boolean;
}> {
  if (!config.auctionAddress) {
    return { currentBatchId: null, referencePriceX18: null, paused: true };
  }

  const [currentBatchId, referencePriceX18, paused] = await Promise.all([
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
    publicClient.readContract({
      address: config.auctionAddress,
      abi: nyxBatchAuctionAbi,
      functionName: "paused",
    }),
  ]);
  return { currentBatchId, referencePriceX18, paused };
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
  expiresAt: bigint;
  status: number;
}> {
  const [trader, batchId, sellToken, sellAmount, submittedAt, expiresAt, status] =
    (await publicClient.readContract({
      address: auctionAddress,
      abi: nyxBatchAuctionAbi,
      functionName: "getOrder",
      args: [commitment],
    })) as [Address, bigint, Address, bigint, bigint, bigint, number];

  return {
    trader: getAddress(trader),
    batchId,
    sellToken: getAddress(sellToken),
    sellAmount,
    submittedAt,
    expiresAt,
    status: Number(status),
  };
}

export async function readSubmittedStatuses(
  publicClient: PublicClient,
  config: AgentConfig,
  commitments: Hex32[],
): Promise<Map<Hex32, "queued" | "settled" | "cancelled">> {
  const statuses = new Map<Hex32, "queued" | "settled" | "cancelled">();
  if (!config.auctionAddress) return statuses;

  const onchainOrders = await Promise.all(
    commitments.map(async (commitment) => ({
      commitment,
      order: await readOrder(publicClient, config.auctionAddress as Address, commitment),
    })),
  );
  for (const { commitment, order } of onchainOrders) {
    if (order.status === 1) statuses.set(commitment, "queued");
    if (order.status === 2) statuses.set(commitment, "settled");
    if (order.status === 3) statuses.set(commitment, "cancelled");
  }
  return statuses;
}

export async function readLatestBatchSettledReason(
  publicClient: PublicClient,
  config: AgentConfig,
): Promise<number | null> {
  return (await readLatestBatchSettlement(publicClient, config))?.reason ?? null;
}

export async function readLatestBatchSettlement(
  publicClient: PublicClient,
  config: AgentConfig,
): Promise<LatestBatchSettlement | null> {
  if (!config.auctionAddress) return null;

  const latestBlock = await publicClient.getBlockNumber();
  const ranges = splitBlockRange(config.fromBlock, latestBlock).reverse();
  for (let offset = 0; offset < ranges.length; offset += LOG_SCAN_CONCURRENCY) {
    const settled = (
      await Promise.all(
        ranges.slice(offset, offset + LOG_SCAN_CONCURRENCY).map(async (range) => {
          const chunk = await publicClient.getContractEvents({
            address: config.auctionAddress,
            abi: nyxBatchAuctionAbi,
            eventName: "BatchSettled",
            fromBlock: range.fromBlock,
            toBlock: range.toBlock,
          });
          return chunk as unknown as AuctionEventLog[];
        }),
      )
    ).flat();
    const latest = selectLatestSettlementLog(settled);
    if (latest?.args.reason != null && latest.blockNumber != null) {
      const block = await publicClient.getBlock({ blockNumber: latest.blockNumber });
      return {
        reason: Number(latest.args.reason),
        blockNumber: latest.blockNumber,
        timestamp: Number(block.timestamp),
      };
    }
  }
  return null;
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

export async function sendSettleWithGasBuffer(
  publicClient: PublicClient,
  walletClient: WalletClient,
  request: Parameters<WalletClient["writeContract"]>[0],
): Promise<Hex32> {
  const gas = await publicClient.estimateContractGas(request as never);
  // Submit once. An RPC error after write may be ambiguous, so replaying here
  // could send a second settlement transaction. Recovery reconciles by chain.
  return (await walletClient.writeContract({
    ...request,
    gas: (gas * 125n) / 100n,
  } as never)) as Hex32;
}

async function readTokenInfo(publicClient: PublicClient, address: Address): Promise<TokenInfo> {
  const [symbol, decimals] = await Promise.all([
    publicClient.readContract({ address, abi: erc20Abi, functionName: "symbol" }),
    publicClient.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
  ]);
  return { address, symbol, decimals };
}
