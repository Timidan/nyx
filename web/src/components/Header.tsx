import { IS_LIVE } from "../lib/config";
import { ConnectButton } from "./ConnectButton";
import { StatusPill } from "./StatusPill";

export function Header() {
  return (
    <header className="sticky top-0 z-20 border-b-2 border-border bg-ground">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3.5">
        <div className="flex items-baseline gap-3">
          <span className="font-pixel text-[1.375rem] leading-none text-text">
            Nyx
          </span>
          <span className="hidden font-mono text-[0.6875rem] uppercase tracking-widest text-faint sm:inline">
            private batch auctions
          </span>
        </div>
        <div className="flex items-center gap-3">
          {!IS_LIVE && (
            <span className="border-2 border-border bg-note px-2 py-1 font-mono text-[0.6875rem] text-text shadow-[2px_2px_0_0_#0A0A0A]">
              Simulated data
            </span>
          )}
          <StatusPill />
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}
