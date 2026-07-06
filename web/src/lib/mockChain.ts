import type { AgentState, AgentStatus, Batch, SealResult, SealedOrder } from "../types";

// -----------------------------------------------------------------------------
// Mock on-chain source.
//
// This simulates the agent + Settlement contract so the frontend runs, animates,
// and demos before any contract is wired. It settles a new batch every ~15-25s
// on a randomly chosen reason (0-4), drives the agent status through
// watching -> deciding -> settling, and keeps live heuristic readings.
//
// It is the ONLY place mock behaviour lives. The hooks read from it; when the
// contracts are ready, the hooks swap their data source to viem and this file
// is deleted. See the SWAP POINT comments in src/hooks/*.
// -----------------------------------------------------------------------------

const PAIR = "WBOT/USDC";
const DEPTH_THRESHOLD = 8;
const NOTIONAL_MAX = 25000;

const HEX = "0123456789abcdef";
function randHex(bytes: number): `0x${string}` {
  let out = "0x";
  for (let i = 0; i < bytes * 2; i++) out += HEX[Math.floor(Math.random() * 16)];
  return out as `0x${string}`;
}
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function randFloat(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}
function clampPrice(p: number): number {
  return +Math.max(1.02, Math.min(1.07, p)).toFixed(4);
}

type Listener = () => void;

class MockChain {
  private listeners = new Set<Listener>();
  private batches: Batch[] = [];
  private status: AgentStatus = "watching";
  private lastReason: number | null = null;
  private depth = 2;
  private notionalWaiting = 4200;
  private secsSinceLastClear = 0;
  private dexPrice = 1.0432;
  private nextBatchId = 1;
  private countdown = randInt(15, 25);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.seed();
    this.startTimer();
  }

  // ---- subscription -------------------------------------------------------
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private notify() {
    for (const l of this.listeners) l();
  }

  // ---- reads (what the hooks call) ---------------------------------------
  getBatches(): Batch[] {
    // React Query structural sharing collapses this back to a stable reference
    // when nothing changed, so returning a fresh array each poll is cheap.
    return [...this.batches];
  }

  getAgentState(): AgentState {
    return {
      status: this.status,
      live: true,
      lastReason: this.lastReason,
      depth: this.depth,
      depthThreshold: DEPTH_THRESHOLD,
      notionalWaiting: this.notionalWaiting,
      notionalMax: NOTIONAL_MAX,
      secsSinceLastClear: this.secsSinceLastClear,
      dexPrice: this.dexPrice,
      pair: PAIR,
    };
  }

  // ---- writes -------------------------------------------------------------
  async submitOrder(order: SealedOrder): Promise<SealResult> {
    // simulate the seal + escrow round-trip
    await new Promise((r) => setTimeout(r, 700));
    this.depth = Math.min(DEPTH_THRESHOLD, this.depth + 1);
    this.notionalWaiting += Math.round(order.amount * order.limitPrice);
    this.notify();
    return { commitment: randHex(32), side: order.side };
  }

  // ---- simulation ---------------------------------------------------------
  private seed() {
    const now = Date.now();
    for (let i = 0; i < 12; i++) {
      const reason = randInt(0, 4);
      this.batches.push({
        batchId: this.nextBatchId++,
        matchCount: randInt(2, 14),
        clearingPrice: clampPrice(this.dexPrice + randFloat(-0.004, 0.004)),
        reason,
        txHash: randHex(32),
        settledAt: now - (12 - i) * 20000,
      });
    }
    this.lastReason = this.batches[this.batches.length - 1]!.reason;
  }

  private startTimer() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 1000);
  }

  private tick() {
    this.secsSinceLastClear += 1;
    this.dexPrice = clampPrice(this.dexPrice + randFloat(-0.0012, 0.0012));

    if (this.status === "watching") {
      if (this.depth < DEPTH_THRESHOLD && Math.random() < 0.4) this.depth += 1;
      this.notionalWaiting += randInt(0, 800);
      this.countdown -= 1;
      if (this.countdown <= 3) this.status = "deciding";
    } else if (this.status === "deciding") {
      this.countdown -= 1;
      if (this.countdown <= 0) this.settle();
    }

    this.notify();
  }

  private settle() {
    const reason = randInt(0, 4);
    const matchCount = Math.max(
      2,
      Math.min(14, Math.round(this.depth * randFloat(0.6, 1.1)) + randInt(0, 3)),
    );
    this.batches.push({
      batchId: this.nextBatchId++,
      matchCount,
      clearingPrice: clampPrice(this.dexPrice + randFloat(-0.0025, 0.0025)),
      reason,
      txHash: randHex(32),
      settledAt: Date.now(),
    });
    if (this.batches.length > 200) this.batches.shift();

    this.lastReason = reason;
    this.status = "settling";
    this.secsSinceLastClear = 0;
    this.depth = randInt(0, 2);
    this.notionalWaiting = randInt(1500, 5000);
    this.countdown = randInt(15, 25);

    // hold on the warm "settling" state briefly, then return to watching
    setTimeout(() => {
      this.status = "watching";
      this.notify();
    }, 1600);
  }
}

// Module singleton — one simulated chain shared by every hook.
export const mockChain = new MockChain();
