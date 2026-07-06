import type { ReactNode } from "react";
import { useBatches } from "../hooks/useBatches";
import { reasonWords } from "../lib/reasons";
import { truncateHash, txUrl } from "../lib/format";

export function ClearingFeed() {
  const { data: batches = [] } = useBatches();
  const rows = [...batches].reverse().slice(0, 24);

  return (
    <section className="rounded-card border border-border bg-surface p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-[1.25rem] font-semibold text-text">
          Clearing feed
        </h2>
        <span className="font-mono text-[0.75rem] text-faint">
          latest {rows.length}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] border-collapse font-mono text-[0.8125rem] tabular-nums">
          <thead>
            <tr className="border-b border-border text-left text-faint">
              <Th>batch</Th>
              <Th>matches</Th>
              <Th>clearing</Th>
              <Th>reason</Th>
              <Th align="right">tx</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr
                key={b.batchId}
                className="border-b border-border/50 last:border-0 hover:bg-surface-2/40"
              >
                <td className="py-2 pr-3 text-text">#{b.batchId}</td>
                <td className="py-2 pr-3 text-text">{b.matchCount}</td>
                <td className="py-2 pr-3 text-settle">
                  {b.clearingPrice.toFixed(4)}
                </td>
                <td className="py-2 pr-3 text-muted">{reasonWords(b.reason)}</td>
                <td className="py-2 text-right">
                  <a
                    href={txUrl(b.txHash)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-signal hover:underline"
                  >
                    {truncateHash(b.txHash)}
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      className={`pb-2 pr-3 font-normal uppercase tracking-wider ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}
