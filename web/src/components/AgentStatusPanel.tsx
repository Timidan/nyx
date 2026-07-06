import { useAgentState } from "../hooks/useAgentState";
import { reasonWords } from "../lib/reasons";
import { fmtToken, fmtUsd } from "../lib/format";
import type { AgentStatus } from "../types";

const SUBTEXT: Record<AgentStatus, string> = {
  watching: "accumulating sealed orders",
  deciding: "evaluating clear conditions",
  settling: "submitting settlement",
};

export function AgentStatusPanel() {
  const { data } = useAgentState();
  if (!data) return null;

  const headline =
    data.status === "settling"
      ? `Cleared: ${reasonWords(data.lastReason)}`
      : `Waiting: depth ${data.depth} of ${data.depthThreshold}`;

  return (
    <section
      className="rounded-panel border border-border bg-surface p-5"
      // 1px top border in --signal-dim while the agent is live (plan recipe).
      style={data.live ? { borderTopColor: "#2A7A80" } : undefined}
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-[1.25rem] font-semibold text-text">
          Agent
        </h2>
        {data.live ? (
          <span className="flex items-center gap-1.5 font-mono text-[0.6875rem] uppercase tracking-wider text-signal">
            <span className="h-1.5 w-1.5 rounded-full bg-signal" />
            live
          </span>
        ) : (
          <span className="font-mono text-[0.6875rem] uppercase tracking-wider text-faint">
            agent unreachable
          </span>
        )}
      </div>

      <div className="rounded-card border border-border bg-ground p-3">
        <div className="font-mono text-[0.8125rem] text-text">{headline}</div>
        <div className="mt-1 font-mono text-[0.75rem] text-faint">
          {SUBTEXT[data.status]}
        </div>
      </div>

      <dl className="mt-4 space-y-3">
        <Meter
          label="depth"
          value={`${data.depth} / ${data.depthThreshold}`}
          fill={data.depth / data.depthThreshold}
        />
        {data.notionalWaiting !== undefined && data.notionalMax !== undefined && (
          <Meter
            label="notional waiting"
            value={
              data.notionalSymbol
                ? `${fmtToken(data.notionalWaiting)} / ${fmtToken(data.notionalMax)} ${data.notionalSymbol}`
                : `${fmtUsd(data.notionalWaiting)} / ${fmtUsd(data.notionalMax)}`
            }
            fill={data.notionalWaiting / data.notionalMax}
          />
        )}
        {data.reasonCandidate != null && (
          <Row label="reason candidate" value={data.reasonCandidate.label} />
        )}
        {data.currentBatchId != null && (
          <Row label="current batch" value={`#${data.currentBatchId}`} />
        )}
        <Row
          label="since last clear"
          value={
            data.secsSinceLastClear === null
              ? "—"
              : `${data.secsSinceLastClear}s`
          }
        />
        <Row
          label={`${data.pair} DEX ref`}
          value={data.dexPrice === null ? "—" : data.dexPrice.toFixed(4)}
          valueClass={data.dexPrice === null ? "text-faint" : "text-settle"}
        />
      </dl>
    </section>
  );
}

function Meter({
  label,
  value,
  fill,
}: {
  label: string;
  value: string;
  fill: number;
}) {
  const pct = Math.max(0, Math.min(1, fill)) * 100;
  return (
    <div>
      <div className="flex items-center justify-between">
        <dt className="font-mono text-[0.75rem] text-muted">{label}</dt>
        <dd className="font-mono text-[0.8125rem] tabular-nums text-text">
          {value}
        </dd>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-ground">
        <div
          className="h-full rounded-full bg-signal-dim"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  valueClass = "text-text",
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <dt className="font-mono text-[0.75rem] text-muted">{label}</dt>
      <dd className={`font-mono text-[0.8125rem] tabular-nums ${valueClass}`}>
        {value}
      </dd>
    </div>
  );
}
