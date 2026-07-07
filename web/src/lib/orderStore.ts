import type { OrderRevealWire, OrderSide } from "../types";

// Local record of orders this browser placed, keyed per wallet. Nothing here
// is more private than the reveal preimage the agent already received; the
// reveal wire (incl. salt) is kept only while its delivery still needs a
// retry, and dropped once delivered.

export interface StoredOrder {
  commitment: `0x${string}`;
  batchId: string;
  side: OrderSide;
  /** human base-token amount as entered in the form */
  amount: number;
  limitPrice: number;
  txHash: `0x${string}`;
  revealDelivered: boolean;
  /** kept only until delivered, for the retry button */
  reveal: OrderRevealWire | null;
  createdAt: number;
}

const KEY_PREFIX = "nyx.orders.968.";
const MAX_STORED = 50;
const REVEAL_RETRY_TTL_MS = 30 * 60 * 1000;

function storageKey(address: string): string {
  return `${KEY_PREFIX}${address.toLowerCase()}`;
}

export function loadOrders(address: string): StoredOrder[] {
  try {
    const raw = localStorage.getItem(storageKey(address));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredOrder[];
    if (!Array.isArray(parsed)) return [];
    const orders = parsed.map(dropExpiredReveal);
    if (JSON.stringify(orders) !== JSON.stringify(parsed)) {
      saveOrders(address, orders);
    }
    return orders;
  } catch {
    return [];
  }
}

function dropExpiredReveal(order: StoredOrder): StoredOrder {
  if (
    order.revealDelivered ||
    order.reveal === null ||
    Date.now() - order.createdAt <= REVEAL_RETRY_TTL_MS
  ) {
    return order;
  }
  return { ...order, reveal: null };
}

function saveOrders(address: string, orders: StoredOrder[]): void {
  try {
    localStorage.setItem(
      storageKey(address),
      JSON.stringify(orders.slice(-MAX_STORED)),
    );
  } catch {
    // storage full/blocked — tracking is best-effort, the chain stays canonical
  }
}

export function recordOrder(address: string, order: StoredOrder): void {
  const orders = loadOrders(address).filter(
    (o) => o.commitment !== order.commitment,
  );
  orders.push(order);
  saveOrders(address, orders);
}

/** Mark a stored order's reveal as delivered and drop the kept preimage. */
export function markRevealDelivered(
  address: string,
  commitment: `0x${string}`,
): void {
  const orders = loadOrders(address).map((o) =>
    o.commitment === commitment
      ? { ...o, revealDelivered: true, reveal: null }
      : o,
  );
  saveOrders(address, orders);
}

/** Drop the retry preimage without marking the reveal as delivered. */
export function forgetReveal(address: string, commitment: `0x${string}`): void {
  const orders = loadOrders(address).map((o) =>
    o.commitment === commitment ? { ...o, reveal: null } : o,
  );
  saveOrders(address, orders);
}
