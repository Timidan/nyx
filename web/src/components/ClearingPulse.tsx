import { useEffect, useRef } from "react";
import { useBatches } from "../hooks/useBatches";
import { reasonWords } from "../lib/reasons";
import { txUrl } from "../lib/format";
import type { Batch } from "../types";

// How many recent bars the live window shows. Older batches scroll off the left
// but remain in the clearing feed below.
const MAX_BARS = 56;

/**
 * The clearing pulse — the signature element. A live horizontal timeline where
 * each settled batch is one bar, height ∝ match count, filled --settle. A new
 * settlement grows in with the plan's --pulse curve; every other bar stays put.
 */
export function ClearingPulse() {
  const { data: batches = [] } = useBatches();
  const view = batches.slice(-MAX_BARS);
  const maxMatch = Math.max(4, ...view.map((b) => b.matchCount));

  // Track which batch ids we've already painted so only *new* settlements
  // animate. Seed with whatever is on screen at first paint (no intro animation
  // for the seeded history). Updated in an effect, never during render, so it
  // stays StrictMode-safe.
  const seen = useRef<Set<number>>(new Set(view.map((b) => b.batchId)));
  const freshIds = view
    .filter((b) => !seen.current.has(b.batchId))
    .map((b) => b.batchId);

  useEffect(() => {
    for (const b of view) seen.current.add(b.batchId);
  });

  return (
    <section className="rounded-panel border border-border bg-surface p-5">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h2 className="font-display text-[1.75rem] font-semibold leading-none text-text">
            Clearing pulse
          </h2>
          <p className="mt-1.5 font-mono text-[0.75rem] text-faint">
            one bar per settled batch · height maps match count · fill on settle
          </p>
        </div>
        <div className="text-right font-mono text-[0.75rem] text-muted">
          <span className="tabular-nums text-text">{batches.length}</span> batches
          cleared
        </div>
      </div>

      <div className="relative flex h-48 items-end gap-[3px] pt-12">
        {view.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center font-mono text-[0.8125rem] text-faint">
            no batches yet
          </div>
        ) : (
          view.map((b) => (
            <PulseBar
              key={b.batchId}
              batch={b}
              maxMatch={maxMatch}
              isNew={freshIds.includes(b.batchId)}
            />
          ))
        )}
      </div>
    </section>
  );
}

function PulseBar({
  batch,
  maxMatch,
  isNew,
}: {
  batch: Batch;
  maxMatch: number;
  isNew: boolean;
}) {
  // Floor at 12% so the smallest batches still read as a pulse.
  const heightPct = 12 + (batch.matchCount / maxMatch) * 88;

  return (
    <div className="group/bar relative flex h-full flex-1 items-end">
      <div
        className={`w-full rounded-t-[2px] bg-settle/85 transition-colors group-hover/bar:bg-settle ${
          isNew ? "pulse-grow" : ""
        }`}
        style={{ height: `${heightPct}%` }}
      />

      <div className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 hidden w-56 -translate-x-1/2 rounded-card border border-border bg-surface-2 p-3 text-left shadow-xl group-hover/bar:block">
        <Line label="batch" value={`#${batch.batchId}`} />
        <Line
          label="clearing price"
          value={batch.clearingPrice.toFixed(4)}
          valueClass="text-settle"
        />
        <Line label="matches" value={String(batch.matchCount)} />
        <div className="mt-2 border-t border-border pt-2 font-mono text-[0.75rem] text-text">
          {reasonWords(batch.reason)}
        </div>
        <a
          href={txUrl(batch.txHash)}
          target="_blank"
          rel="noreferrer"
          className="pointer-events-auto mt-2 inline-block font-mono text-[0.75rem] text-signal hover:underline"
        >
          view tx ↗
        </a>
      </div>
    </div>
  );
}

function Line({
  label,
  value,
  valueClass = "text-text",
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="mt-1 flex items-center justify-between gap-4 first:mt-0">
      <span className="font-mono text-[0.75rem] text-muted">{label}</span>
      <span className={`font-mono text-[0.8125rem] tabular-nums ${valueClass}`}>
        {value}
      </span>
    </div>
  );
}
