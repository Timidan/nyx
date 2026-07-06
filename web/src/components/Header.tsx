import { StatusPill } from "./StatusPill";

export function Header() {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-ground/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3.5">
        <div className="flex items-baseline gap-2.5">
          <span className="font-display text-2xl font-bold tracking-tight text-text">
            Nyx
          </span>
          <span className="hidden font-mono text-[0.6875rem] uppercase tracking-widest text-faint sm:inline">
            private batch auctions
          </span>
        </div>
        <StatusPill />
      </div>
    </header>
  );
}
