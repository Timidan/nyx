export interface BrowserProvider {
  request(args: { method: string; params?: readonly unknown[] | object }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
}

export interface DiscoveredWallet {
  id: string;
  name: string;
  icon?: string;
  provider: BrowserProvider;
}

export function upsertDiscoveredWallet(
  wallets: DiscoveredWallet[],
  announced: DiscoveredWallet,
): DiscoveredWallet[] {
  const index = wallets.findIndex((wallet) => wallet.id === announced.id);
  if (index === -1) return [...wallets, announced];
  const next = [...wallets];
  next[index] = announced;
  return next;
}

export function requireExpectedChainId(value: unknown, expected: number): number {
  let actual: number;
  try {
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") {
      throw new Error();
    }
    actual = Number(BigInt(value));
  } catch {
    throw new Error("Wallet returned an invalid chain id.");
  }
  if (actual !== expected) {
    throw new Error(`Wallet is still on chain ${actual}; expected chain ${expected}.`);
  }
  return actual;
}
