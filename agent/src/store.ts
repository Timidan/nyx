import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Hex32, OrderReveal, QueuedOrder, QueueStatus } from "./types.js";

interface StoredOrderJson {
  commitment: Hex32;
  order: {
    trader: string;
    batchId: string;
    sellToken: string;
    sellAmount: string;
    minBuyAmount: string;
    salt: Hex32;
  };
  status: QueueStatus;
  receivedAt: number;
  quarantineReason?: string;
}

export class OrderStore {
  private orders = new Map<Hex32, QueuedOrder>();
  private saveQueue: Promise<void> = Promise.resolve();

  constructor(private readonly path: string) {}

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.path, "utf8");
      const parsed = JSON.parse(raw) as StoredOrderJson[];
      this.orders = new Map(parsed.map((entry) => [entry.commitment, fromJson(entry)]));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.orders = new Map();
    }
  }

  async save(): Promise<void> {
    const next = this.saveQueue.then(
      () => this.writeSnapshot(),
      () => this.writeSnapshot(),
    );
    this.saveQueue = next.catch(() => undefined);
    await next;
  }

  private async writeSnapshot(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const body = JSON.stringify([...this.orders.values()].map(toJson), null, 2);
    const tempPath = `${this.path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, `${body}\n`, { mode: 0o600 });
    await rename(tempPath, this.path);
  }

  all(): QueuedOrder[] {
    return [...this.orders.values()];
  }

  get(commitment: Hex32): QueuedOrder | undefined {
    return this.orders.get(commitment);
  }

  async upsert(commitment: Hex32, order: OrderReveal): Promise<QueuedOrder> {
    const existing = this.orders.get(commitment);
    const queued: QueuedOrder = {
      commitment,
      order,
      status: existing?.status ?? "queued",
      receivedAt: existing?.receivedAt ?? Date.now(),
      quarantineReason: existing?.quarantineReason,
    };
    this.orders.set(commitment, queued);
    await this.save();
    return queued;
  }

  async mark(commitment: Hex32, status: QueueStatus, quarantineReason?: string): Promise<void> {
    const existing = this.orders.get(commitment);
    if (!existing) return;
    this.orders.set(commitment, { ...existing, status, quarantineReason });
    await this.save();
  }
}

function toJson(entry: QueuedOrder): StoredOrderJson {
  return {
    commitment: entry.commitment,
    order: {
      trader: entry.order.trader,
      batchId: entry.order.batchId.toString(),
      sellToken: entry.order.sellToken,
      sellAmount: entry.order.sellAmount.toString(),
      minBuyAmount: entry.order.minBuyAmount.toString(),
      salt: entry.order.salt,
    },
    status: entry.status,
    receivedAt: entry.receivedAt,
    quarantineReason: entry.quarantineReason,
  };
}

function fromJson(entry: StoredOrderJson): QueuedOrder {
  return {
    commitment: entry.commitment,
    order: {
      trader: entry.order.trader as OrderReveal["trader"],
      batchId: BigInt(entry.order.batchId),
      sellToken: entry.order.sellToken as OrderReveal["sellToken"],
      sellAmount: BigInt(entry.order.sellAmount),
      minBuyAmount: BigInt(entry.order.minBuyAmount),
      salt: entry.order.salt,
    },
    status: entry.status,
    receivedAt: entry.receivedAt,
    quarantineReason: entry.quarantineReason,
  };
}
