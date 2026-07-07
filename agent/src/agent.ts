import { formatUnits, getAddress, type PublicClient } from "viem";
import { decide, reasonLabels, type Decision } from "./policy.js";
import { toX18 } from "./math.js";
import { buildComplementarySettlement } from "./matcher.js";
import {
  hashOrder,
  makePublicClient,
  makeWalletClient,
  readAuctionSnapshot,
  readDexSnapshot,
  readLatestBatchSettledReason,
  readOrder,
  readSubmittedStatuses,
  sendSettleWithGasBump,
  simulateSettle,
} from "./chain.js";
import { readAgentPrivateKey, type AgentConfig } from "./config.js";
import { OrderStore } from "./store.js";
import type { AgentStatus, DexSnapshot, Hex32, OrderReveal, QueuedOrder } from "./types.js";

export class NyxAgent {
  private readonly publicClient: PublicClient;
  private readonly store: OrderStore;
  private currentBatchId: bigint | null = null;
  private referencePriceX18: bigint | null = null;
  private dexSnapshot: DexSnapshot | null = null;
  private lastDecision: Decision | null = null;
  private lastReason: number | null = null;
  private lastTx: Hex32 | null = null;
  private lastClearAt = Math.floor(Date.now() / 1000);
  private state = "starting";
  private running = false;

  constructor(private readonly config: AgentConfig) {
    this.publicClient = makePublicClient(config);
    this.store = new OrderStore(config.storePath);
  }

  async init(): Promise<void> {
    await this.store.load();
    await this.recover();
  }

  async recover(): Promise<void> {
    this.state = "recovering";
    const [statuses, lastReason] = await Promise.all([
      readSubmittedStatuses(this.publicClient, this.config),
      readLatestBatchSettledReason(this.publicClient, this.config),
    ]);
    this.lastReason = lastReason;
    for (const entry of this.store.all()) {
      const onchainStatus = statuses.get(entry.commitment);
      if (onchainStatus === "settled" || onchainStatus === "cancelled") {
        await this.store.mark(entry.commitment, onchainStatus);
      }
      if (onchainStatus === "queued" && entry.status !== "quarantined") {
        await this.store.mark(entry.commitment, "queued");
      }
    }
    this.state = "watching";
  }

  async submitOrder(order: OrderReveal): Promise<{ commitment: Hex32; status: string }> {
    if (!this.config.auctionAddress) {
      throw new Error("NYX_BATCH_AUCTION is required before POST /orders can hash preimages");
    }
    const commitment = await hashOrder(this.publicClient, this.config.auctionAddress, order);
    await this.assertSubmittedOrder(commitment, order);
    await this.store.upsert(commitment, {
      ...order,
      trader: getAddress(order.trader),
      sellToken: getAddress(order.sellToken),
    });
    return { commitment, status: "queued" };
  }

  private async assertSubmittedOrder(commitment: Hex32, order: OrderReveal): Promise<void> {
    if (!this.config.auctionAddress) throw new Error("NYX_BATCH_AUCTION is not configured");

    const onchain = await readOrder(this.publicClient, this.config.auctionAddress, commitment);
    const submittedStatus = 1;
    if (onchain.status !== submittedStatus) {
      throw new Error("order commitment is not submitted on-chain");
    }
    if (
      !sameAddress(onchain.trader, order.trader) ||
      onchain.batchId !== order.batchId ||
      !sameAddress(onchain.sellToken, order.sellToken) ||
      onchain.sellAmount !== order.sellAmount
    ) {
      throw new Error("reveal does not match submitted on-chain order");
    }
  }

  async runOnce(): Promise<Decision> {
    const perceived = await this.perceive();
    const decision = this.decide(perceived.queue);
    this.lastDecision = decision;

    if (this.config.dryRun) {
      this.state = "dry-run";
      this.printDryRun(decision);
      return decision;
    }

    await this.act(decision, perceived.queue);
    return decision;
  }

  async startLoop(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.runOnce().catch((error) => {
      this.state = `error: ${(error as Error).message}`;
      console.error(error);
    });

    setInterval(() => {
      if (!this.running) return;
      this.runOnce().catch((error) => {
        this.state = `error: ${(error as Error).message}`;
        console.error(error);
      });
    }, this.config.pollMs);
  }

  getStatus(): AgentStatus {
    const queue = this.queue();
    const depth = queue.length;
    return {
      currentBatchId: this.currentBatchId?.toString() ?? null,
      reasonCandidate:
        this.lastDecision?.reason == null
          ? null
          : { code: this.lastDecision.reason, label: reasonLabels[this.lastDecision.reason] },
      queueDepth: depth,
      lastReason: this.lastReason,
      depth,
      depthMin: this.config.depthMin,
      notionalWaiting: this.notionalWaitingX18(queue).toString(),
      notionalMax: this.config.notionalMaxX18.toString(),
      notionalUnit: "token1X18",
      decision: {
        side0X18: this.lastDecision?.side0X18.toString() ?? "0",
        side1X18: this.lastDecision?.side1X18.toString() ?? "0",
        imbalanceBps: this.lastDecision?.imbalanceBps ?? null,
        dexSpreadOk: this.lastDecision?.dexSpreadOk ?? false,
      },
      config: {
        imbalanceBps: this.config.imbalanceBps,
        maxIntervalSeconds: this.config.maxIntervalSeconds,
        dexSpreadBps: this.config.dexSpreadBps,
        maxClearingDeviationBps: this.config.maxClearingDeviationBps,
      },
      lastTx: this.lastTx,
      referencePriceX18: this.referencePriceX18?.toString() ?? null,
      secondsSinceLastClear: Math.max(0, Math.floor(Date.now() / 1000) - this.lastClearAt),
      agentState: this.state,
    };
  }

  async health() {
    const [chainId, blockNumber] = await Promise.all([
      this.publicClient.getChainId(),
      this.publicClient.getBlockNumber(),
    ]);
    return {
      ok: chainId === this.config.chainId,
      process: { pid: process.pid, uptime: process.uptime() },
      rpc: { chainId, blockNumber: blockNumber.toString() },
      auctionConfigured: Boolean(this.config.auctionAddress),
    };
  }

  private async perceive(): Promise<{ queue: QueuedOrder[] }> {
    this.state = "perceiving";
    this.dexSnapshot = await readDexSnapshot(this.publicClient, this.config);
    const auction = await readAuctionSnapshot(this.publicClient, this.config);
    this.currentBatchId = auction.currentBatchId ?? 0n;
    this.referencePriceX18 = auction.referencePriceX18 ?? this.dexSnapshot.referencePriceX18;

    this.state = "deciding";
    return { queue: this.queue() };
  }

  private decide(queue: QueuedOrder[]): Decision {
    if (!this.dexSnapshot || this.currentBatchId == null || this.referencePriceX18 == null) {
      throw new Error("perceive must run before decide");
    }

    return decide({
      queue,
      currentBatchId: this.currentBatchId,
      referencePriceX18: this.referencePriceX18,
      secondsSinceLastClear: Math.max(0, Math.floor(Date.now() / 1000) - this.lastClearAt),
      token0: this.config.wbot,
      token1: this.config.bousdt,
      token0Decimals: this.dexSnapshot.token0.decimals,
      token1Decimals: this.dexSnapshot.token1.decimals,
      depthMin: this.config.depthMin,
      imbalanceBps: this.config.imbalanceBps,
      notionalMaxX18: this.config.notionalMaxX18,
      maxIntervalSeconds: this.config.maxIntervalSeconds,
      dexSpreadBps: this.config.dexSpreadBps,
    });
  }

  private async act(decision: Decision, queue: QueuedOrder[]): Promise<void> {
    if (decision.reason == null) {
      this.state = "watching";
      return;
    }
    if (!this.config.auctionAddress) {
      this.state = "waiting: NYX_BATCH_AUCTION not configured";
      return;
    }
    if (!this.dexSnapshot || this.currentBatchId == null || this.referencePriceX18 == null) {
      throw new Error("missing perceived state");
    }

    const settlement = buildComplementarySettlement({
      queue,
      referencePriceX18: this.referencePriceX18,
      token0: this.config.wbot,
      token1: this.config.bousdt,
      token0Decimals: this.dexSnapshot.token0.decimals,
      token1Decimals: this.dexSnapshot.token1.decimals,
      maxDeviationBps: this.config.maxClearingDeviationBps,
    });

    if (!settlement) {
      this.state = "waiting: no exactly balanced reveal set";
      return;
    }

    const privateKey = readAgentPrivateKey();
    if (!privateKey) {
      this.state = "waiting: AGENT_PRIVATE_KEY not set";
      return;
    }

    this.state = "simulating";
    const { account, walletClient } = makeWalletClient(this.config, privateKey);
    let simulation;
    try {
      simulation = await simulateSettle(
        this.publicClient,
        this.config,
        account,
        this.currentBatchId,
        settlement.clearingPriceX18,
        decision.reason,
        settlement.matches,
      );
    } catch (error) {
      const reason = `simulate failed: ${(error as Error).message}`;
      await Promise.all(
        settlement.matches.map((match) => this.store.mark(match.commitment, "quarantined", reason)),
      );
      this.state = "quarantined: simulation failed";
      return;
    }

    this.state = "settling";
    const txHash = await sendSettleWithGasBump(
      this.publicClient,
      walletClient,
      simulation.request,
      2,
    );
    this.lastTx = txHash;
    await this.publicClient.waitForTransactionReceipt({ hash: txHash });
    await Promise.all(settlement.matches.map((match) => this.store.mark(match.commitment, "settled")));
    this.lastClearAt = Math.floor(Date.now() / 1000);
    this.lastReason = decision.reason;
    this.state = "watching";
  }

  private queue(): QueuedOrder[] {
    return this.store
      .all()
      .filter((entry) => entry.status === "queued")
      .filter((entry) => this.currentBatchId == null || entry.order.batchId === this.currentBatchId);
  }

  private notionalWaitingX18(queue: QueuedOrder[]): bigint {
    if (!this.dexSnapshot || this.referencePriceX18 == null) return 0n;
    return queue.reduce((sum, entry) => {
      if (sameAddress(entry.order.sellToken, this.config.wbot)) {
        const sellX18 = toX18(entry.order.sellAmount, this.dexSnapshot!.token0.decimals);
        return sum + (sellX18 * this.referencePriceX18!) / 1_000000000000000000n;
      }
      if (sameAddress(entry.order.sellToken, this.config.bousdt)) {
        return sum + toX18(entry.order.sellAmount, this.dexSnapshot!.token1.decimals);
      }
      return sum;
    }, 0n);
  }

  private printDryRun(decision: Decision): void {
    const price = this.referencePriceX18 ?? 0n;
    const humanPrice = formatUnits(price, 18);
    console.log(
      JSON.stringify(
        {
          mode: "dry-run",
          currentBatchId: this.currentBatchId?.toString() ?? null,
          referencePriceX18: price.toString(),
          referencePriceBousdtPerWbot: humanPrice,
          queueDepth: decision.queueDepth,
          reasonCandidate:
            decision.reason == null ? null : { code: decision.reason, label: decision.label },
          decision: {
            side0X18: decision.side0X18.toString(),
            side1X18: decision.side1X18.toString(),
            imbalanceBps: decision.imbalanceBps,
            dexSpreadOk: decision.dexSpreadOk,
          },
          config: {
            imbalanceBps: this.config.imbalanceBps,
            maxIntervalSeconds: this.config.maxIntervalSeconds,
            dexSpreadBps: this.config.dexSpreadBps,
            maxClearingDeviationBps: this.config.maxClearingDeviationBps,
          },
          auctionConfigured: Boolean(this.config.auctionAddress),
          agentState: this.state,
        },
        null,
        2,
      ),
    );
  }
}

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}
