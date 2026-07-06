import { useEffect, useRef } from "react";
import { useAuctionMeta } from "../hooks/useAuctionMeta";
import { useBatches } from "../hooks/useBatches";
import { useBatchValues } from "../hooks/useBatchValues";
import { IS_LIVE } from "../lib/config";
import { fmtToken, txUrl } from "../lib/format";
import { reasonWords } from "../lib/reasons";
import { Window } from "./Window";
import type { Batch } from "../types";

// How many recent bars the live window shows. Older rounds scroll off the left
// but remain in the settled-rounds feed below.
const MAX_BARS = 56;

/** reason code -> bar/legend color (static classes so Tailwind compiles them) */
const REASON_BG: Record<number, string> = {
  0: "bg-signal", // teal — enough orders queued
  1: "bg-navy", // navy — buys and sells matched at market price
  2: "bg-settle", // green — enough value queued
  3: "bg-amber", // amber — time limit reached
  4: "bg-plum", // plum — market moved in traders' favor
};

/** Mock mode has no OrderSettled stream — derive a stable, varied value. */
function pseudoValue(b: Batch): number {
  return (((b.batchId * 37) % 90) + 12) / 100 + b.matchCount * 0.05;
}

/**
 * Agent activity — the signature element. One block per settled round; height
 * maps the BOUSDT value that changed hands, color maps why the agent settled.
 * A new settlement grows in with the 220ms pulse curve; everything else stays
 * put (and the grow is dropped under prefers-reduced-motion).
 */
export function ClearingPulse() {
  const { data: batches = [] } = useBatches();
  const { data: values } = useBatchValues();
  const { data: meta } = useAuctionMeta();
  const quoteSymbol = meta?.quote.symbol ?? "BOUSDT";

  const view = batches.slice(-MAX_BARS);
  const valueOf = (b: Batch): number | undefined =>
    IS_LIVE ? values?.[b.batchId] : pseudoValue(b);
  const maxValue = Math.max(1e-6, ...view.map((b) => valueOf(b) ?? 0));

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
    <Window title="agent-activity.exe">
      <div className="mb-4 flex items-start justify-between gap-6">
        <div>
          <h2 className="font-display text-[1.75rem] font-semibold leading-none text-text">
            Agent activity
          </h2>
          <p className="mt-1.5 max-w-xl font-mono text-[0.75rem] text-faint">
            Each block is a round of hidden orders the agent matched and settled
            on-chain. Hover a block for details.
          </p>
        </div>
        <div className="shrink-0 text-right font-mono text-[0.75rem] text-muted">
          <span className="tabular-nums text-text">{batches.length}</span> rounds
          settled
        </div>
      </div>

      <div className="relative flex h-48 items-end gap-[3px] pt-12">
        {view.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center font-mono text-[0.8125rem] text-faint">
            no rounds yet
          </div>
        ) : (
          view.map((b) => (
            <PulseBar
              key={b.batchId}
              batch={b}
              value={valueOf(b)}
              maxValue={maxValue}
              quoteSymbol={quoteSymbol}
              isNew={freshIds.includes(b.batchId)}
            />
          ))
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-ground pt-3">
        {[0, 1, 2, 3, 4].map((code) => (
          <span
            key={code}
            className="flex items-center gap-1.5 font-mono text-[0.6875rem] text-muted"
          >
            <span
              className={`h-2.5 w-2.5 shrink-0 border border-border ${REASON_BG[code]}`}
            />
            {reasonWords(code)}
          </span>
        ))}
      </div>
    </Window>
  );
}

function PulseBar({
  batch,
  value,
  maxValue,
  quoteSymbol,
  isNew,
}: {
  batch: Batch;
  value: number | undefined;
  maxValue: number;
  quoteSymbol: string;
  isNew: boolean;
}) {
  // Floor at 12% so small rounds stay visible.
  const heightPct = 12 + ((value ?? 0) / maxValue) * 88;

  return (
    <div className="group/bar relative flex h-full flex-1 items-end">
      <div
        className={`w-full border-2 border-border transition-opacity group-hover/bar:opacity-80 ${
          REASON_BG[batch.reason] ?? "bg-signal"
        } ${isNew ? "pulse-grow" : ""}`}
        style={{ height: `${heightPct}%` }}
      />

      <div className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 hidden w-60 -translate-x-1/2 border-2 border-border bg-surface p-3 text-left shadow-tip group-hover/bar:block">
        <Line label="round" value={`#${batch.batchId}`} />
        <Line
          label="price"
          value={batch.clearingPrice.toFixed(4)}
          valueClass="text-settle"
        />
        <Line label="orders" value={String(batch.matchCount)} />
        {value !== undefined && (
          <Line label="traded" value={`~${fmtToken(value)} ${quoteSymbol}`} />
        )}
        <div className="mt-2 border-t border-border pt-2 font-mono text-[0.75rem] text-text">
          {reasonWords(batch.reason)}
        </div>
        <a
          href={txUrl(batch.txHash)}
          target="_blank"
          rel="noreferrer"
          className="pointer-events-auto mt-2 inline-block font-mono text-[0.75rem] text-navy underline hover:no-underline"
        >
          receipt ↗
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
