import { useState } from "react";
import { useAgentState } from "../hooks/useAgentState";
import { useAuctionInfo } from "../hooks/useAuctionInfo";
import { useBatches } from "../hooks/useBatches";
import { AUCTION_ADDRESS, IS_LIVE } from "../lib/config";
import { addressUrl, truncateHash, txUrl } from "../lib/format";
import { PngIcon, SealIcon } from "./Icons";
import { Window } from "./Window";

/** Quiet judge-facing proof strip: every load-bearing on-chain fact in one
 *  row, copyable, linking to the explorer. Live mode only — there is nothing
 *  to prove about the simulator. */
export function ProofStrip() {
  const { data: agentState } = useAgentState();
  const { data: info, isLoading: infoLoading } = useAuctionInfo();
  const { data: batches = [], isLoading: batchesLoading } = useBatches();

  if (!IS_LIVE) return null;

  const latest = batches.length > 0 ? batches[batches.length - 1] : undefined;

  if (infoLoading && batchesLoading) {
    return (
      <Window title="proof.exe" icon={<SealIcon />} bodyClassName="px-5 py-3">
        <div className="flex flex-wrap items-center gap-2">
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className="sunken95 h-7 w-44 animate-pulse motion-reduce:animate-none"
            />
          ))}
        </div>
        <p className="mt-2 font-mono text-[0.6875rem] text-faint">
          reading proof facts from the chain
        </p>
      </Window>
    );
  }

  return (
    <Window title="proof.exe" icon={<SealIcon />} bodyClassName="px-5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Segment
          label="auction contract"
          value={AUCTION_ADDRESS!}
          href={addressUrl(AUCTION_ADDRESS!)}
          iconSrc="/icons/explorer.png"
        />
        {info?.agent && (
          <Segment
            label="agent wallet"
            value={info.agent}
            href={addressUrl(info.agent)}
            iconSrc="/icons/explorer.png"
          />
        )}
        {agentState?.currentBatchId != null && (
          <Segment
            label="current round"
            value={`#${agentState.currentBatchId}`}
            copyValue={String(agentState.currentBatchId)}
          />
        )}
        {info?.referenceOracle && (
          <Segment
            label="V3 TWAP oracle"
            value={info.referenceOracle}
            href={addressUrl(info.referenceOracle)}
            iconSrc="/icons/explorer.png"
          />
        )}
        {latest && (
          <Segment
            label="last settlement tx"
            value={latest.txHash}
            href={txUrl(latest.txHash)}
            iconSrc="/icons/explorer.png"
          />
        )}
        {latest?.settlementHash && (
          <Segment label="settlement hash" value={latest.settlementHash} />
        )}
      </div>
      <p className="mt-2 font-mono text-[0.6875rem] text-faint">
        Everything above is linked to the configured chain explorer.
      </p>
    </Window>
  );
}

function Segment({
  label,
  value,
  copyValue,
  href,
  iconSrc,
}: {
  label: string;
  /** full value; hex strings are truncated for display */
  value: string;
  copyValue?: string;
  href?: string;
  /** brand mark shown before the label (explorer / botdex) */
  iconSrc?: string;
}) {
  const [copied, setCopied] = useState(false);
  const display = value.startsWith("0x") ? truncateHash(value) : value;

  function onCopy() {
    navigator.clipboard
      .writeText(copyValue ?? value)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      })
      .catch(() => {
        // clipboard blocked — the explorer link still carries the value
      });
  }

  return (
    <span className="sunken95 flex items-center gap-2 px-2 py-1 font-mono text-[0.6875rem]">
      {iconSrc && <PngIcon src={iconSrc} size={14} />}
      <span className="text-faint">{label}</span>
      <button
        type="button"
        onClick={onCopy}
        title="Copy"
        className="tabular-nums text-text hover:text-link"
      >
        {copied ? "copied" : display}
      </button>
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          aria-label={`${label} on explorer`}
          className="text-link underline hover:no-underline"
        >
          ↗
        </a>
      )}
    </span>
  );
}
