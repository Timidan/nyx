import { REASON_BG, REASON_TEXT } from "../lib/reasons";

/** ~10 chunky blocks, like the Win95 installer bar. */
const SEGMENTS = 10;

export interface TraceMeterProps {
  /** one-word caption: "orders" / "balance" / "value" / "time" / "spread" */
  label: string;
  /** terse mono reading under the bar, e.g. "1/4", "—", ">60s" */
  reading: string;
  /** 0..1 progress toward the trigger's threshold (clamped here) */
  progress: number;
  /** trigger condition currently met -> full bar + lit LED + bright label */
  met: boolean;
  /** reason code 0-4 — the meter fills with that reason's chart token so it
   *  matches the activity chart, legend, and feed squares */
  reason: number;
  /** full explanatory sentence (the old row copy): title tooltip + aria-label */
  sentence: string;
}

/**
 * One decision-trigger cell: caption + LED, a Win95 segmented progress bar
 * (sunken well, chunky blocks, 2px gaps), and a tiny mono reading. The visual
 * interior is aria-hidden; the <li> carries the full sentence for screen
 * readers and as a hover tooltip.
 */
export function TraceMeter({
  label,
  reading,
  progress,
  met,
  reason,
  sentence,
}: TraceMeterProps) {
  const p = met ? 1 : Math.min(Math.max(progress, 0), 1);
  let filled = Math.round(p * SEGMENTS);
  if (p > 0 && filled === 0) filled = 1; // any progress shows a block
  if (p < 1 && filled === SEGMENTS) filled = SEGMENTS - 1; // full bar = 100% only

  return (
    <li className="min-w-0" aria-label={sentence} title={sentence}>
      <div aria-hidden="true">
        <div className="flex items-center justify-between gap-1">
          <span
            className={`truncate font-mono text-[0.6875rem] ${
              met ? "text-text" : "text-faint"
            }`}
          >
            {label}
          </span>
          <span
            className={`h-2 w-2 shrink-0 border border-border ${
              met ? "crt-glow bg-signal text-signal" : "bg-ground"
            }`}
          />
        </div>
        <div
          className={`sunken95 mt-1 flex gap-[2px] p-[2px] ${
            met ? `crt-glow ${REASON_TEXT[reason] ?? "text-chart-0"}` : ""
          }`}
        >
          {Array.from({ length: SEGMENTS }, (_, i) => (
            <span
              key={i}
              className={`h-3 min-w-0 flex-1 ${
                i < filled ? (REASON_BG[reason] ?? "bg-chart-0") : "bg-surface-2"
              }`}
            />
          ))}
        </div>
        <div className="mt-1 truncate font-mono text-[0.6875rem] tabular-nums text-muted">
          {reading}
        </div>
      </div>
    </li>
  );
}
