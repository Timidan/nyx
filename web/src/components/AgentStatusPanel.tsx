import type { ReactNode } from "react";
import { useAgentState } from "../hooks/useAgentState";
import { REASON_BG, reasonWords } from "../lib/reasons";
import { fmtAgo, fmtDur, fmtToken, fmtUsd } from "../lib/format";
import { MonitorIcon } from "./Icons";
import { TraceMeter, type TraceMeterProps } from "./TraceMeter";
import { Window } from "./Window";
import type { AgentState, AgentStatus } from "../types";

const SUBTEXT: Record<AgentStatus, string> = {
  watching: "waiting for more orders",
  deciding: "deciding whether to settle now",
  settling: "writing the settlement on-chain",
};

/** Ultra-terse meter reading number: 0.0000030 -> "0.00", 1 -> "1.0",
 *  42 -> "42", 4200 -> "4.2k". Full precision lives in the sentence. */
function tiny(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  if (n >= 10) return n.toFixed(0);
  if (n >= 1) return n.toFixed(1);
  return n.toFixed(2);
}

type MeterDatum = TraceMeterProps & { key: string };

/** Decision-trace meters in the agent's priority order. Each maps to the
 *  reason code it would settle with, so the fill color matches the chart,
 *  legend, and feed squares. Meters for /status v3 fields appear only when
 *  the agent sends them (older builds hide them). */
function traceMeters(data: AgentState): MeterDatum[] {
  const meters: MeterDatum[] = [];
  const t = data.trace;

  meters.push({
    key: "depth",
    label: "orders",
    reason: 0,
    met: data.depth >= data.depthThreshold,
    progress: data.depthThreshold > 0 ? data.depth / data.depthThreshold : 0,
    reading: `${data.depth}/${data.depthThreshold}`,
    sentence: `orders waiting: ${data.depth} of ${data.depthThreshold}`,
  });

  if (t?.imbalanceBps !== undefined && t.imbalanceLimitBps !== undefined) {
    const bps = t.imbalanceBps;
    const limit = t.imbalanceLimitBps;
    const limitPct = (limit / 100).toFixed(0);
    const met = bps !== null && bps <= limit;
    meters.push({
      key: "imbalance",
      label: "balance",
      reason: 1,
      met,
      // closeness to being under the threshold; one side empty -> 0
      progress: bps === null ? 0 : met ? 1 : limit / bps,
      reading: bps === null ? "—" : `${(bps / 100).toFixed(1)}/${limitPct}%`,
      sentence:
        bps === null
          ? `buys vs sells: one side empty (fires under ${limitPct}% apart)`
          : `buys vs sells: ${(bps / 100).toFixed(1)}% apart (fires under ${limitPct}%)`,
    });
  }

  if (data.notionalWaiting !== undefined && data.notionalMax !== undefined) {
    const val = data.notionalSymbol
      ? `${fmtToken(data.notionalWaiting)} of ${fmtToken(data.notionalMax)} ${data.notionalSymbol}`
      : `${fmtUsd(data.notionalWaiting)} of ${fmtUsd(data.notionalMax)}`;
    meters.push({
      key: "notional",
      label: "value",
      reason: 2,
      met: data.notionalWaiting >= data.notionalMax,
      progress:
        data.notionalMax > 0 ? data.notionalWaiting / data.notionalMax : 0,
      reading: `${tiny(data.notionalWaiting)}/${tiny(data.notionalMax)}`,
      sentence: `value waiting: ${val}`,
    });
  }

  if (t?.maxIntervalSeconds !== undefined && data.secsSinceLastClear !== null) {
    const secs = data.secsSinceLastClear;
    const max = t.maxIntervalSeconds;
    meters.push({
      key: "interval",
      label: "time",
      reason: 3,
      // the policy only fires the time backstop when orders are waiting
      met: data.depth > 0 && secs >= max,
      progress: max > 0 ? secs / max : 0,
      reading: secs >= max ? `>${max}s` : `${fmtDur(secs)}/${max}s`,
      sentence: `time since last round: ${fmtDur(secs)} of ${max}s limit`,
    });
  }

  if (t?.dexSpreadOk !== undefined) {
    meters.push({
      key: "spread",
      label: "spread",
      reason: 4,
      met: t.dexSpreadOk,
      progress: t.dexSpreadOk ? 1 : 0, // boolean: all-or-nothing fill
      reading: t.dexSpreadOk ? "yes" : "no",
      sentence: `market spread favorable: ${t.dexSpreadOk ? "yes" : "no"}`,
    });
  }

  return meters;
}

export function AgentStatusPanel() {
  const { data, isLoading } = useAgentState();
  if (!data) {
    if (!isLoading) return null;
    return (
      <Window title="agent-monitor.exe" icon={<MonitorIcon />} className="h-full">
        <div className="mb-4 h-7 w-24 animate-pulse bg-surface-2 motion-reduce:animate-none" />
        <div className="sunken95 h-16 animate-pulse motion-reduce:animate-none" />
        <div className="sunken95 mt-3 h-36 animate-pulse motion-reduce:animate-none" />
        <div className="mt-4 space-y-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-4 animate-pulse bg-surface-2 motion-reduce:animate-none"
            />
          ))}
        </div>
      </Window>
    );
  }

  const headline =
    data.status === "settling"
      ? `Settled: ${reasonWords(data.lastReason)}`
      : `Watching: ${data.depth} of ${data.depthThreshold} orders needed`;

  return (
    <Window title="agent-monitor.exe" icon={<MonitorIcon />} className="h-full">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-[1.25rem] font-semibold text-text">
          Agent
        </h2>
        {data.live ? (
          <span className="crt-glow-text flex items-center gap-1.5 font-mono text-[0.6875rem] uppercase tracking-wider text-signal">
            <span className="crt-glow h-1.5 w-1.5 border border-border bg-signal" />
            live
          </span>
        ) : (
          <span className="font-mono text-[0.6875rem] uppercase tracking-wider text-faint">
            agent unreachable
          </span>
        )}
      </div>

      <div className="sunken95 p-3">
        <div className="font-mono text-[0.8125rem] text-text">{headline}</div>
        <div className="mt-1 font-mono text-[0.75rem] text-faint">
          {SUBTEXT[data.status]}
        </div>
      </div>

      <div className="sunken95 mt-3 p-3">
        <div
          className="mb-2 font-mono text-[0.6875rem] text-faint"
          title="the first condition met settles the round"
        >
          why it will fire
          <span className="sr-only">
            : the first condition met settles the round
          </span>
        </div>
        <ul className="grid grid-cols-3 gap-x-3 gap-y-2.5 sm:grid-cols-5">
          {traceMeters(data).map(({ key, ...meter }) => (
            <TraceMeter key={key} {...meter} />
          ))}
        </ul>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5">
        {data.reasonCandidate != null && (
          <Stat label="leaning toward">
            <span
              className="flex items-center gap-1.5"
              title={reasonWords(data.reasonCandidate.code)}
            >
              <span
                className={`h-2.5 w-2.5 shrink-0 border border-border ${
                  REASON_BG[data.reasonCandidate.code] ?? "bg-chart-0"
                }`}
              />
              <span className="truncate">
                {reasonWords(data.reasonCandidate.code)}
              </span>
            </span>
          </Stat>
        )}
        {data.currentBatchId != null && (
          <Stat label="current round">{`#${data.currentBatchId}`}</Stat>
        )}
        <Stat label="last settled">
          {data.secsSinceLastClear === null
            ? "—"
            : fmtAgo(data.secsSinceLastClear)}
        </Stat>
        <Stat
          label="market price (BOT DEX)"
          valueClass={data.dexPrice === null ? "text-faint" : "text-settle"}
        >
          {data.dexPrice === null ? "—" : data.dexPrice.toFixed(4)}
        </Stat>
      </dl>
    </Window>
  );
}

function Stat({
  label,
  children,
  valueClass = "text-text",
}: {
  label: string;
  children: ReactNode;
  valueClass?: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="font-mono text-[0.6875rem] text-muted">{label}</dt>
      <dd
        className={`mt-0.5 font-mono text-[0.8125rem] tabular-nums ${valueClass}`}
      >
        {children}
      </dd>
    </div>
  );
}
