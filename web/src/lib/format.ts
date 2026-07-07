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

/** Link an address out to the BOT Chain explorer. */
export function addressUrl(address: string): string {
  return `${EXPLORER}/address/${address}`;
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

/** Humanized duration: 42s / 6m / 1h 12m / 1d 9h. */
export function fmtDur(secs: number): string {
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    return `${h}h ${m}m`;
  }
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  return `${d}d ${h}h`;
}

/** Humanized elapsed time: 42s ago / 6m ago / 1h 12m ago. */
export function fmtAgo(secs: number): string {
  return `${fmtDur(secs)} ago`;
}

/** Trimmed decimal for form inputs: 0.015000 -> "0.015", 5.000000 -> "5". */
export function trimNum(n: number, maxDecimals = 6): string {
  const s = n.toFixed(maxDecimals).replace(/\.?0+$/, "");
  return s === "" || s === "-" ? "0" : s;
}

/** Estimated-output reading: ~4 sig digits, sensible per-magnitude rounding,
 *  trailing zeros trimmed. Non-positive/NaN -> "—". e.g. 0.095485 -> "0.0955",
 *  1234.5 -> "1234.5", 5 -> "5". */
export function fmtEst(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  const abs = Math.abs(n);
  const decimals = abs >= 1000 ? 2 : abs >= 0.001 ? 4 : 6;
  return trimNum(n, decimals);
}
