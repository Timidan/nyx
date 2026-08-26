import { CHAIN_LABEL } from "../lib/chain";
import { AUCTION_ADDRESS, IS_LIVE } from "../lib/config";
import { truncateHash } from "../lib/format";
import { PngIcon } from "./Icons";

/** Statusbar footer shared by the landing page and the trading desk. */
export function StatusBar() {
  return (
    <footer className="border-t-2 border-border bg-ground px-5 py-2">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 font-mono text-[0.75rem] text-muted">
        <span className="sunken95 px-2 py-0.5 font-pixel text-[0.625rem] leading-none text-text">
          Nyx
        </span>
        <span className="sunken95 flex items-center gap-1.5 px-2 py-0.5">
          <PngIcon src="/icons/botchain.png" size={12} />
          {CHAIN_LABEL}
        </span>
        <span className="sunken95 px-2 py-0.5">
          {IS_LIVE
            ? `auction ${truncateHash(AUCTION_ADDRESS!)}`
            : "no contract configured — simulated data"}
        </span>
      </div>
    </footer>
  );
}
