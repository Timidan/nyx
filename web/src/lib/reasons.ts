// reason code -> plain words. Matches the `BatchSettled(reason)` encoding in
// NyxBatchAuction (docs/INTERFACES.md). Humanized copy (user feedback round):
// the UI explains why a round settled in trader language, never raw codes.
export const REASONS: Record<number, string> = {
  0: "enough orders queued",
  1: "buys and sells matched at market price",
  2: "enough value queued",
  3: "time limit reached",
  4: "market moved in traders' favor",
};

export function reasonWords(code: number | null | undefined): string {
  if (code === null || code === undefined) return "—";
  return REASONS[code] ?? `reason ${code}`;
}
