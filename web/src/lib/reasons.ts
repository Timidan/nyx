// reason code -> plain words. Matches the `BatchSettled(reason)` encoding in the
// Settlement contract (plan section 4). The agent speaks in plain readings, so
// these strings are what the UI shows, never the raw code.
export const REASONS: Record<number, string> = {
  0: "depth threshold",
  1: "buy/sell imbalance at DEX midpoint",
  2: "notional wait limit",
  3: "max interval",
  4: "favorable DEX spread",
};

export function reasonWords(code: number | null | undefined): string {
  if (code === null || code === undefined) return "—";
  return REASONS[code] ?? `reason ${code}`;
}
