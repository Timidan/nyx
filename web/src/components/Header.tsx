import { IS_LIVE } from "../lib/config";
import { ConnectButton } from "./ConnectButton";
import { StatusPill } from "./StatusPill";
import { ThemeToggle } from "./ThemeToggle";

export function Header() {
  return (
    <header className="sticky top-0 z-20 border-b-2 border-border bg-ground">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3.5 sm:px-5">
        <div className="flex items-baseline gap-3">
          <span className="font-pixel text-[1.375rem] leading-none text-text">
            Nyx
          </span>
          <span className="hidden font-mono text-[0.6875rem] uppercase tracking-widest text-faint sm:inline">
            private batch auctions
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {!IS_LIVE && (
            <span className="border-2 border-border bg-note px-2 py-1 font-mono text-[0.6875rem] text-text shadow-[2px_2px_0_0_#0A0A0A]">
              Simulated data
            </span>
          )}
          <StatusPill />
          <ThemeToggle />
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}
