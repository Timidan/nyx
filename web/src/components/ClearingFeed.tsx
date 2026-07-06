import type { ReactNode } from "react";
import { useBatches } from "../hooks/useBatches";
import { reasonWords } from "../lib/reasons";
import { truncateHash, txUrl } from "../lib/format";
import { Window } from "./Window";

export function ClearingFeed() {
  const { data: batches = [] } = useBatches();
  const rows = [...batches].reverse().slice(0, 24);

  return (
    <Window title="settled-rounds.exe">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-[1.25rem] font-semibold text-text">
          Settled rounds
        </h2>
        <span className="font-mono text-[0.75rem] text-faint">
          latest {rows.length}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] border-collapse font-mono text-[0.8125rem] tabular-nums">
          <thead>
            <tr className="border-b-2 border-border text-left text-faint">
              <Th>round</Th>
              <Th>orders</Th>
              <Th>price</Th>
              <Th>why it settled</Th>
              <Th align="right">receipt</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-faint">
                  no rounds settled yet — they'll appear here as the agent
                  trades
                </td>
              </tr>
            )}
            {rows.map((b) => (
              <tr
                key={b.batchId}
                className="border-b border-ground last:border-0 hover:bg-ground/50"
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
                    className="text-navy underline hover:no-underline"
                  >
                    {truncateHash(b.txHash)}
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Window>
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
