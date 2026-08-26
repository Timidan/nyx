import { formatUnits, getAddress, type PublicClient } from "viem";
import { decide, reasonLabels, type Decision } from "./policy.js";
import { toX18 } from "./math.js";
import { buildComplementarySettlement } from "./matcher.js";
import {
  assertSuccessfulReceipt,
  hashOrder,
  makePublicClient,
  makeWalletClient,
  readAuctionSnapshot,
  readMarketSnapshot,
  readLatestBatchSettlement,
  readOrder,
  readStartupState,
  readSubmittedStatuses,
  sendSettleWithGasBuffer,
  simulateSettle,
} from "./chain.js";
import { readAgentPrivateKey, type AgentConfig } from "./config.js";
import { OrderStore } from "./store.js";
import { toQuoteRequest, type QuoteRequest } from "./quotes.js";
import { validateStartupState, type StartupState } from "./startup.js";
import type { AgentStatus, Hex32, MarketSnapshot, MatchedOrder, OrderReveal, QueuedOrder } from "./types.js";

/** How many identical consecutive simulation failures a candidate set must
 *  produce before the agent stops retrying it and sets the orders aside. */
export const SIMULATION_FAILURES_BEFORE_QUARANTINE = 3;

function settlementKey(matches: MatchedOrder[]): string {
  return matches.map((match) => match.commitment).sort().join("|");
}

export class NyxAgent {
  private readonly publicClient: PublicClient;
  private readonly store: OrderStore;
  private currentBatchId: bigint | null = null;
  private referencePriceX18: bigint | null = null;
  private marketSnapshot: MarketSnapshot | null = null;
  private lastDecision: Decision | null = null;
  private lastReason: number | null = null;
  private lastTx: Hex32 | null = null;
  private lastClearAt = Math.floor(Date.now() / 1000);
  private state = "starting";
  private running = false;
  private cycleInFlight = false;
  private auctionPaused = true;
  private startupState: StartupState | null = null;
  /** Consecutive simulation failures per candidate order set. Most causes are
   *  transient: an oracle band the market walks back into, RPC disagreement, a
   *  batch that rolled between read and simulate. Quarantining on the first
   *  failure strands escrow that would have settled on the next cycle, so a
   *  set has to fail repeatedly and identically before it is set aside. */
  private simulationFailures = new Map<string, { reason: string; count: number }>();

  constructor(private readonly config: AgentConfig) {
    this.publicClient = makePublicClient(config);
    this.store = new OrderStore(config.storePath);
  }

  async init(): Promise<void> {
    await this.store.load();
    if (this.config.auctionAddress) {
      const signer = this.signerAddress();
      const startupState = await readStartupState(this.publicClient, this.config, signer);
      validateStartupState(this.config, startupState);
      this.startupState = startupState;
      this.auctionPaused = startupState.paused;
    } else if (!this.config.dryRun) {
      throw new Error("NYX_BATCH_AUCTION is required outside dry-run mode");
    }
    await this.recover();
  }

  /** Counts consecutive identical failures for one candidate set and returns
   *  the attempt number. A different failure reason restarts the count, so an
   *  order set is only set aside once it fails the same way repeatedly. */
  private recordSimulationFailure(key: string, reason: string): number {
    const previous = this.simulationFailures.get(key);
    const count = previous && previous.reason === reason ? previous.count + 1 : 1;
    this.simulationFailures.set(key, { reason, count });
    return count;
  }

  async recover(): Promise<void> {
    this.state = "recovering";
    const entries = this.store.all();
    const [statuses, latestSettlement] = await Promise.all([
      readSubmittedStatuses(
        this.publicClient,
        this.config,
        entries.map((entry) => entry.commitment),
      ),
      readLatestBatchSettlement(this.publicClient, this.config),
    ]);
    this.lastReason = latestSettlement?.reason ?? null;
    if (latestSettlement) {
      this.lastClearAt = latestSettlement.timestamp;
    } else if (this.config.fromBlock > 0n) {
      const deploymentBlock = await this.publicClient.getBlock({
        blockNumber: this.config.fromBlock,
      });
      this.lastClearAt = Number(deploymentBlock.timestamp);
    }
    for (const entry of entries) {
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
      onchain.sellAmount !== order.sellAmount ||
      onchain.expiresAt !== order.expiresAt
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
    await this.runLoopCycle();

    setInterval(() => {
      void this.runLoopCycle();
    }, this.config.pollMs);
  }

  private async runLoopCycle(): Promise<void> {
    if (!this.running || this.cycleInFlight) return;
    this.cycleInFlight = true;
    try {
      await this.runOnce();
    } catch (error) {
      this.state = `error: ${(error as Error).message}`;
      console.error(error);
    } finally {
      this.cycleInFlight = false;
    }
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

  getQuoteRequests(): QuoteRequest[] {
    return this.queue().map(toQuoteRequest);
  }

  async health() {
    try {
      const current = await readStartupState(
        this.publicClient,
        this.config,
        this.signerAddress(),
      );
      validateStartupState(this.config, current);
      this.startupState = current;
      return {
        ok: true,
        process: { pid: process.pid, uptime: process.uptime() },
        rpc: { chainId: current.chainId, blockNumber: current.latestBlock.toString() },
        auctionConfigured: true,
        deploymentVerified: true,
        auctionPaused: current.paused,
        authority: current.contractAgent,
      };
    } catch (error) {
      return {
        ok: false,
        process: { pid: process.pid, uptime: process.uptime() },
        auctionConfigured: Boolean(this.config.auctionAddress),
        deploymentVerified: false,
        error: (error as Error).message,
      };
    }
  }

  private async perceive(): Promise<{ queue: QueuedOrder[] }> {
    this.state = "perceiving";
    const auction = await readAuctionSnapshot(this.publicClient, this.config);
    this.auctionPaused = auction.paused;
    this.currentBatchId = auction.currentBatchId ?? 0n;
    if (auction.referencePriceX18 == null) {
      throw new Error("auction reference price is unavailable");
    }
    this.referencePriceX18 = auction.referencePriceX18;
    this.marketSnapshot = await readMarketSnapshot(
      this.publicClient,
      this.config,
      auction.referencePriceX18,
    );

    this.state = "deciding";
    return { queue: this.queue() };
  }

  private decide(queue: QueuedOrder[]): Decision {
    if (!this.marketSnapshot || this.currentBatchId == null || this.referencePriceX18 == null) {
      throw new Error("perceive must run before decide");
    }

    return decide({
      queue,
      currentBatchId: this.currentBatchId,
      referencePriceX18: this.referencePriceX18,
      secondsSinceLastClear: Math.max(0, Math.floor(Date.now() / 1000) - this.lastClearAt),
      token0: this.config.wbot,
      token1: this.config.bousdt,
      token0Decimals: this.marketSnapshot.token0.decimals,
      token1Decimals: this.marketSnapshot.token1.decimals,
      depthMin: this.config.depthMin,
      imbalanceBps: this.config.imbalanceBps,
      notionalMaxX18: this.config.notionalMaxX18,
      maxIntervalSeconds: this.config.maxIntervalSeconds,
      dexSpreadBps: this.config.dexSpreadBps,
    });
  }

  private async act(decision: Decision, queue: QueuedOrder[]): Promise<void> {
    if (this.auctionPaused) {
      this.state = "paused: waiting for owner";
      return;
    }
    if (decision.reason == null) {
      this.state = "watching";
      return;
    }
    if (!this.config.auctionAddress) {
      this.state = "waiting: NYX_BATCH_AUCTION not configured";
      return;
    }
    if (!this.marketSnapshot || this.currentBatchId == null || this.referencePriceX18 == null) {
      throw new Error("missing perceived state");
    }

    const settlement = buildComplementarySettlement({
      queue,
      referencePriceX18: this.referencePriceX18,
      token0: this.config.wbot,
      token1: this.config.bousdt,
      token0Decimals: this.marketSnapshot.token0.decimals,
      token1Decimals: this.marketSnapshot.token1.decimals,
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
      const key = settlementKey(settlement.matches);
      const attempt = this.recordSimulationFailure(key, reason);

      if (attempt < SIMULATION_FAILURES_BEFORE_QUARANTINE) {
        this.state = `retrying: ${reason} (${attempt}/${SIMULATION_FAILURES_BEFORE_QUARANTINE})`;
        return;
      }

      await Promise.all(
        settlement.matches.map((match) => this.store.mark(match.commitment, "quarantined", reason)),
      );
      this.simulationFailures.delete(key);
      this.state = "quarantined: simulation failed";
      return;
    }

    this.simulationFailures.clear();
    this.state = "settling";
    const txHash = await sendSettleWithGasBuffer(
      this.publicClient,
      walletClient,
      simulation.request,
    );
    this.lastTx = txHash;
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash });
    assertSuccessfulReceipt(receipt);
    await Promise.all(settlement.matches.map((match) => this.store.mark(match.commitment, "settled")));
    this.lastClearAt = Math.floor(Date.now() / 1000);
    this.lastReason = decision.reason;
    this.state = "watching";
  }

  private queue(): QueuedOrder[] {
    return this.store
      .all()
      .filter((entry) => entry.status === "queued")
      .filter((entry) => entry.order.expiresAt > BigInt(Math.floor(Date.now() / 1000)))
      .filter((entry) => this.currentBatchId == null || entry.order.batchId === this.currentBatchId);
  }

  private notionalWaitingX18(queue: QueuedOrder[]): bigint {
    if (!this.marketSnapshot || this.referencePriceX18 == null) return 0n;
    return queue.reduce((sum, entry) => {
      if (sameAddress(entry.order.sellToken, this.config.wbot)) {
        const sellX18 = toX18(entry.order.sellAmount, this.marketSnapshot!.token0.decimals);
        return sum + (sellX18 * this.referencePriceX18!) / 1_000000000000000000n;
      }
      if (sameAddress(entry.order.sellToken, this.config.bousdt)) {
        return sum + toX18(entry.order.sellAmount, this.marketSnapshot!.token1.decimals);
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

  private signerAddress(): `0x${string}` | undefined {
    const privateKey = readAgentPrivateKey();
    if (!privateKey) return undefined;
    return makeWalletClient(this.config, privateKey).account.address;
  }
}

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}
