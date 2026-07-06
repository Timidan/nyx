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
