import { useEffect, useRef, useState } from "react";
import { useAuctionMeta } from "../hooks/useAuctionMeta";
import { useBatches } from "../hooks/useBatches";
import { useBatchValues } from "../hooks/useBatchValues";
import { IS_LIVE } from "../lib/config";
import { fmtToken, txUrl } from "../lib/format";
import { REASON_BG, REASON_TEXT, reasonWords } from "../lib/reasons";
import { ChartIcon, PngIcon } from "./Icons";
import { Window } from "./Window";
import type { Batch } from "../types";

// How many recent rounds the live window plots. Older rounds scroll off the
// left but remain in the settled-rounds feed below.
const MAX_POINTS = 56;

/** Mock mode has no OrderSettled stream — derive a stable, varied value. */
function pseudoValue(b: Batch): number {
  return (((b.batchId * 37) % 90) + 12) / 100 + b.matchCount * 0.05;
}

/** Live matchMedia read of the reduced-motion preference (line-draw and point
 *  pop are JS-driven inline styles, so they can't lean on the CSS media query
 *  the way the class-based motions do). */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/**
 * Agent activity — the signature element. A value-over-rounds line: one point
 * per settled round (left→right, #1…#N), the connecting line the neutral value
 * trend, a soft area fill beneath it, and each point colored by why the agent
 * settled. The line draws in on mount / on a fresh settlement; the new point
 * pops (both dropped under prefers-reduced-motion). Everything else stays put.
 */
export function ClearingPulse() {
  const { data: batches = [], isLoading } = useBatches();
  const { data: values } = useBatchValues();
  const { data: meta } = useAuctionMeta();
  const quoteSymbol = meta?.quote.symbol ?? "BOUSDT";
  const reduced = usePrefersReducedMotion();

  const view = batches.slice(-MAX_POINTS);
  const n = view.length;
  const valueOf = (b: Batch): number | undefined =>
    IS_LIVE ? values?.[b.batchId] : pseudoValue(b);
  const pointValues = view.map((b) => valueOf(b) ?? 0);
  const maxValue = Math.max(1e-6, ...pointValues);
  // Selective direct label: only the peak round prints its value; every other
  // point is tooltip-only.
  const maxIdx = pointValues.indexOf(maxValue);

  // Track which batch ids we've already painted so only *new* settlements
  // animate. Seed with whatever is on screen at first paint (the seeded history
  // gets no per-point pop). Updated in an effect, never during render.
  const seen = useRef<Set<number>>(new Set(view.map((b) => b.batchId)));
  const freshIds = view
    .filter((b) => !seen.current.has(b.batchId))
    .map((b) => b.batchId);
  useEffect(() => {
    for (const b of view) seen.current.add(b.batchId);
  });

  // Re-draw the trend line whenever a genuinely new round appears (newest id
  // climbs) — and once on mount. Gated on the id, so the 5s live poll does not
  // redraw when nothing settled.
  const newestId = n > 0 ? view[n - 1].batchId : -1;
  const lastNewest = useRef(newestId);
  const [drawSeq, setDrawSeq] = useState(0);
  useEffect(() => {
    if (newestId > lastNewest.current) {
      lastNewest.current = newestId;
      setDrawSeq((s) => s + 1);
    }
  }, [newestId]);

  // Geometry in a normalized 0..100 × 0..100 viewBox: value 0 → baseline (100),
  // maxValue → top tick (0); points centered in equal round slots so they line
  // up with the #N labels below. True values (a line reads small values fine),
  // so no visibility floor.
  const coords = view.map((_, i) => {
    const f = pointValues[i] / maxValue; // 0..1 of the y-scale
    return {
      x: ((i + 0.5) / Math.max(1, n)) * 100,
      y: (1 - f) * 100,
      f,
    };
  });
  const linePoints = coords
    .map((c) => `${c.x.toFixed(2)},${c.y.toFixed(2)}`)
    .join(" ");
  const areaPoints =
    n > 1
      ? `${coords[0].x.toFixed(2)},100 ${linePoints} ${coords[n - 1].x.toFixed(2)},100`
      : "";
  const ariaLabel =
    n > 0
      ? `Value settled across ${n} rounds, #${view[0].batchId} to #${view[n - 1].batchId}. Peak ${fmtToken(maxValue)} ${quoteSymbol}.`
      : "No settled rounds yet.";

  return (
    <Window title="agent-activity.exe" icon={<ChartIcon />}>
      <div className="mb-4 flex items-start justify-between gap-6">
        <div>
          <h2 className="font-display text-[1.75rem] font-semibold leading-none text-text">
            Agent activity
          </h2>
          <p className="mt-1.5 max-w-xl text-balance font-mono text-[0.75rem] text-faint">
            Each point is a round of hidden orders the agent matched and settled
            on-chain. Hover a point for details.
          </p>
        </div>
        <div className="shrink-0 text-right font-mono text-[0.75rem] tabular-nums text-muted">
          {isLoading ? (
            "reading the chain"
          ) : (
            <>
              <span className="text-text">{batches.length}</span> rounds settled
            </>
          )}
        </div>
      </div>

      <div className="flex gap-2">
        {/* y-scale: value traded per round, BOUSDT; labels center on the
            gridlines (max tick sits below the direct-label headroom) */}
        <div className="flex h-52 w-12 shrink-0 flex-col justify-between pb-px pt-[15px] text-right font-mono text-[0.625rem] tabular-nums text-faint">
          <span>{isLoading ? "" : fmtToken(maxValue)}</span>
          <span>{isLoading ? "" : fmtToken(maxValue / 2)}</span>
          <span>0</span>
        </div>

        <div className="min-w-0 flex-1">
          {/* Modern instrument in Win95 chrome: sunken well, faint gridlines +
              baseline, a neutral value line over a soft area fill, reason-
              colored points. top-5 reserves headroom for the peak's label. */}
          <div className="sunken95 relative h-52">
            <div
              aria-hidden="true"
              className="plot-gridlines inset-x-1.5 bottom-1.5 top-5"
            />

            {/* plot region — shared coordinate box for the svg and the points */}
            <div className="absolute inset-x-1.5 bottom-1.5 top-5">
              {isLoading ? (
                <SkeletonPlot />
              ) : n === 0 ? (
                <div className="absolute inset-0 flex items-center justify-center font-mono text-[0.8125rem] text-faint">
                  no rounds yet
                </div>
              ) : (
                <>
                  <svg
                    className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                    role="img"
                    aria-label={ariaLabel}
                  >
                    <defs>
                      <linearGradient
                        id="nyx-area-grad"
                        gradientUnits="userSpaceOnUse"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="100"
                      >
                        <stop
                          offset="0"
                          style={{
                            stopColor: "var(--color-muted)",
                            stopOpacity: 0.12,
                          }}
                        />
                        <stop
                          offset="1"
                          style={{
                            stopColor: "var(--color-muted)",
                            stopOpacity: 0,
                          }}
                        />
                      </linearGradient>
                    </defs>
                    {n > 1 && (
                      <Trend
                        line={linePoints}
                        area={areaPoints}
                        drawSeq={drawSeq}
                        reduced={reduced}
                      />
                    )}
                  </svg>

                  {/* points + full-height hit columns */}
                  <div className="absolute inset-0 flex">
                    {view.map((b, i) => (
                      <PulsePoint
                        key={b.batchId}
                        batch={b}
                        value={valueOf(b)}
                        f={coords[i].f}
                        quoteSymbol={quoteSymbol}
                        isNew={freshIds.includes(b.batchId)}
                        isMax={i === maxIdx}
                        reduced={reduced}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* round numbers under the points (gapless slots so they align) */}
          {!isLoading && n > 0 && (
            <div className="mt-1 flex px-1.5">
              {view.map((b, i) => (
                <span
                  key={b.batchId}
                  className="flex-1 truncate text-center font-mono text-[0.625rem] tabular-nums text-faint"
                >
                  {i % Math.ceil(n / 14) === 0 ? `#${b.batchId}` : ""}
                </span>
              ))}
            </div>
          )}
        </div>
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

/** The neutral value trend: a soft area fill under a 2px ink line. On mount and
 *  on each fresh settlement the line strokes itself in (pathLength-normalized
 *  dash, so it's scale-independent) and the area fades up; both are instant
 *  under prefers-reduced-motion. */
function Trend({
  line,
  area,
  drawSeq,
  reduced,
}: {
  line: string;
  area: string;
  drawSeq: number;
  reduced: boolean;
}) {
  const [drawn, setDrawn] = useState(reduced);
  useEffect(() => {
    if (reduced) {
      setDrawn(true);
      return;
    }
    setDrawn(false); // hide, then draw on the next frame so the transition runs
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setDrawn(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [drawSeq, reduced]);

  return (
    <>
      <polygon
        points={area}
        fill="url(#nyx-area-grad)"
        style={{
          opacity: drawn ? 1 : 0,
          transition: reduced ? undefined : "opacity 720ms ease",
        }}
      />
      <polyline
        points={line}
        fill="none"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        pathLength={1}
        style={{
          stroke: "var(--color-muted)",
          strokeDasharray: 1,
          strokeDashoffset: drawn ? 0 : 1,
          transition: reduced
            ? undefined
            : "stroke-dashoffset 720ms cubic-bezier(0.2, 0.8, 0.2, 1)",
        }}
      />
    </>
  );
}

/** A faint, animated placeholder trend while the chain is read. */
function SkeletonPlot() {
  const pts = "6,70 20,46 34,58 48,32 62,50 76,26 90,42";
  return (
    <svg
      className="absolute inset-0 h-full w-full animate-pulse motion-reduce:animate-none"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polygon points={`6,100 ${pts} 90,100`} style={{ fill: "var(--color-surface-2)" }} />
      <polyline
        points={pts}
        fill="none"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
        style={{ stroke: "var(--color-surface-2)" }}
      />
    </svg>
  );
}

function PulsePoint({
  batch,
  value,
  f,
  quoteSymbol,
  isNew,
  isMax,
  reduced,
}: {
  batch: Batch;
  value: number | undefined;
  f: number;
  quoteSymbol: string;
  isNew: boolean;
  isMax: boolean;
  reduced: boolean;
}) {
  // Fresh settlements pop in; seeded history (and reduced motion) shows instant.
  const [shown, setShown] = useState(!isNew || reduced);
  useEffect(() => {
    if (isNew && !reduced) {
      const raf = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(raf);
    }
  }, [isNew, reduced]);

  const yPct = f * 100; // bottom offset — value 0 sits on the baseline

  return (
    // The full column is the hover hit target, not just the tiny marker.
    <div
      className="group/bar relative flex-1 hover:z-20"
      title={`round #${batch.batchId} · ${reasonWords(batch.reason)}${
        value !== undefined ? ` · ~${fmtToken(value)} ${quoteSymbol}` : ""
      }`}
      aria-label={`round #${batch.batchId}, ${reasonWords(batch.reason)}${
        value !== undefined ? `, ~${fmtToken(value)} ${quoteSymbol}` : ""
      }`}
    >
      {isMax && value !== undefined && (
        <span
          className="pointer-events-none absolute left-1/2 z-10 -translate-x-1/2 whitespace-nowrap font-mono text-[0.625rem] tabular-nums text-muted transition-opacity group-hover/bar:opacity-0"
          style={{ bottom: `calc(${yPct}% + 7px)` }}
        >
          {fmtToken(value)}
        </span>
      )}

      {/* Marker: reason-colored square with a surface ring (keeps adjacent /
          overlapping points separable); enlarges + phosphor-glows on hover
          (reason-hued, via the existing crt-col rule) and pops on settle. */}
      <div
        className="pointer-events-none absolute left-1/2"
        style={{
          bottom: `${yPct}%`,
          transform: `translate(-50%, 50%) scale(${shown ? 1 : 0.2})`,
          opacity: shown ? 1 : 0,
          transition: reduced
            ? undefined
            : "transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 220ms ease",
        }}
      >
        <div
          className={`crt-col h-[7px] w-[7px] border-[1.5px] border-surface transition-transform duration-150 group-hover/bar:scale-[1.7] ${
            REASON_BG[batch.reason] ?? "bg-chart-0"
          } ${REASON_TEXT[batch.reason] ?? "text-chart-0"}`}
        />
      </div>

      <div className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 hidden w-60 -translate-x-1/2 border-2 border-border bg-surface shadow-tip group-hover/bar:block">
        <div
          aria-hidden="true"
          className="border-b-2 border-border bg-navy px-2.5 py-1 text-left font-pixel text-[0.625rem] leading-none text-white"
        >
          round #{batch.batchId}
        </div>
        <div className="p-3 text-left">
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
            className="pointer-events-auto mt-2 inline-flex items-center gap-1 font-mono text-[0.75rem] text-link underline hover:no-underline"
          >
            <PngIcon src="/icons/explorer.png" /> receipt ↗
          </a>
        </div>
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
