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

/** reason code -> chart-mark fill class (static strings so Tailwind compiles
 *  them). Colors come from the validated --color-chart-{n} palette; shared by
 *  the activity chart, its legend, the feed's reason squares, and the landing
 *  decide.exe list so reason colors match everywhere. */
export const REASON_BG: Record<number, string> = {
  0: "bg-chart-0", // teal — enough orders queued
  1: "bg-chart-1", // indigo — buys and sells matched at market price
  2: "bg-chart-2", // green — enough value queued
  3: "bg-chart-3", // amber — time limit reached
  4: "bg-chart-4", // purple — market moved in traders' favor
};

/** reason code -> matching TEXT color. Sets currentColor on a chart bar so
 *  its dark-mode CRT hover bloom (box-shadow) glows in the bar's own hue. */
export const REASON_TEXT: Record<number, string> = {
  0: "text-chart-0",
  1: "text-chart-1",
  2: "text-chart-2",
  3: "text-chart-3",
  4: "text-chart-4",
};
