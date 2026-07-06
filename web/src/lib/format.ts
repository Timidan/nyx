import { formatUnits } from "viem";

const EXPLORER = "https://scan.bohr.life";

/** 0x1234…abcd — truncated hash/address for dense data rows. */
export function truncateHash(hash: string, lead = 6, tail = 4): string {
  if (hash.length <= lead + tail + 1) return hash;
  return `${hash.slice(0, lead)}…${hash.slice(-tail)}`;
}

/** Link a tx hash out to the BOT Chain explorer. */
export function txUrl(hash: string): string {
  return `${EXPLORER}/tx/${hash}`;
}

/** Compact quote-currency reading, e.g. $4.2k. */
export function fmtUsd(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${Math.round(n)}`;
}

/** 1e18-scaled fixed-point (…X18) -> human number for display. */
export function fromX18(x: bigint | string): number {
  return Number(formatUnits(typeof x === "bigint" ? x : BigInt(x), 18));
}

/** Compact token amount, e.g. 1.2k / 4.20 / 0.0042. */
export function fmtToken(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  if (n >= 1) return n.toFixed(2);
  if (n === 0) return "0";
  return n.toPrecision(2);
}
