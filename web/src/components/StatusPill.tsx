import { useAgentState } from "../hooks/useAgentState";
import { reasonWords } from "../lib/reasons";
import type { AgentStatus } from "../types";

const STATE_META: Record<AgentStatus, { label: string; dot: string; text: string }> = {
  watching: {
    label: "Watching",
    dot: "bg-muted",
    text: "text-muted",
  },
  deciding: {
    label: "Deciding",
    dot: "bg-signal",
    text: "text-signal",
  },
  settling: {
    label: "Settling",
    dot: "bg-settle",
    text: "text-settle",
  },
};

export function StatusPill() {
  const { data } = useAgentState();
  if (!data) return null;

  const meta = STATE_META[data.status];
  const reasonLine =
    data.lastReason !== null
      ? `cleared: ${reasonWords(data.lastReason)}`
      : "watching the book";

  return (
    <div className="sunken95 flex items-center gap-2.5 px-3 py-1.5">
      <span className="relative flex h-2.5 w-2.5">
        {data.status === "deciding" && (
          <span className="absolute inline-flex h-full w-full animate-ping bg-signal opacity-60 motion-reduce:hidden" />
        )}
        <span
          className={`relative inline-flex h-2.5 w-2.5 border border-border ${meta.dot}`}
        />
      </span>
      <span className={`font-mono text-[0.75rem] font-medium ${meta.text}`}>
        {meta.label}
      </span>
      <span className="hidden max-w-[24rem] truncate font-mono text-[0.75rem] text-muted md:inline">
        · {reasonLine}
      </span>
    </div>
  );
}
