import { AmbientLayers } from "./components/AmbientLayers";
import { MonitorIcon, OrderPadIcon, SealIcon } from "./components/Icons";
import { ThemeToggle } from "./components/ThemeToggle";
import { Window } from "./components/Window";
import { QUOTE_PROVIDER_APPLY_URL } from "./lib/config";

export function Liquidity() {
  return (
    <div className="flex min-h-screen flex-col text-text">
      <AmbientLayers />
      <header className="sticky top-0 z-20 border-b-2 border-border bg-ground">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-3.5 sm:px-5">
          <a href="/" className="font-pixel text-[1.375rem] leading-none text-text">
            Nyx
          </a>
          <div className="flex items-center gap-3">
            <a href="/app" className="font-mono text-[0.75rem] text-link underline">
              Trading desk
            </a>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-12 sm:px-5">
        <section className="max-w-3xl">
          <p className="font-mono text-[0.75rem] uppercase tracking-widest text-signal">
            Founding Quote Network
          </p>
          <h1 className="mt-3 font-display text-[clamp(2rem,6vw,3.5rem)] font-semibold leading-tight text-text">
            Bring the other side of the trade.
          </h1>
          <p className="mt-4 max-w-2xl text-balance font-mono text-[0.8125rem] leading-relaxed text-muted">
            Nyx is opening mainnet as a capped canary. We are onboarding a small
            group of independent quote providers before increasing trader limits.
            Providers keep custody of inventory and choose every limit they submit.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            {QUOTE_PROVIDER_APPLY_URL ? (
              <a
                href={QUOTE_PROVIDER_APPLY_URL}
                target="_blank"
                rel="noreferrer"
                className="btn95 bg-navy px-5 py-2.5 font-medium text-white"
              >
                Apply to provide quotes ↗
              </a>
            ) : (
              <span className="sunken95 px-4 py-2.5 font-mono text-[0.75rem] text-muted">
                Applications open when the operator configures the onboarding link.
              </span>
            )}
            <a href="/app" className="btn95 bg-surface px-5 py-2.5 font-medium text-text">
              Inspect the live desk
            </a>
          </div>
        </section>

        <section className="mt-12 grid gap-5 md:grid-cols-3">
          <Window title="observe.exe" icon={<MonitorIcon />}>
            <h2 className="font-display text-[1.125rem] font-semibold text-text">1. Observe flow</h2>
            <p className="mt-2 font-mono text-[0.75rem] leading-relaxed text-muted">
              A provider-authenticated feed exposes commitment, side, size, round,
              and expiry. It omits trader, limit, and salt.
            </p>
          </Window>
          <Window title="quote.exe" icon={<OrderPadIcon />}>
            <h2 className="font-display text-[1.125rem] font-semibold text-text">2. Choose a quote</h2>
            <p className="mt-2 font-mono text-[0.75rem] leading-relaxed text-muted">
              Submit a complementary sealed-limit order from a distinct allowlisted
              wallet. There are no forced fills and no delegated custody.
            </p>
          </Window>
          <Window title="prove.exe" icon={<SealIcon />}>
            <h2 className="font-display text-[1.125rem] font-semibold text-text">3. Verify settlement</h2>
            <p className="mt-2 font-mono text-[0.75rem] leading-relaxed text-muted">
              The contract enforces exact token conservation, limit prices, TWAP
              deviation, expiry, escrow caps, and cross-side self-trade rejection.
            </p>
          </Window>
        </section>

        <section className="sunken95 mt-8 max-w-3xl p-4 font-mono text-[0.75rem] leading-relaxed text-muted">
          Quote-provider access is intentionally narrow. It does not bundle a solver,
          custody service, indexer, or hedging venue. Providers operate their own
          wallet and risk controls; Nyx only supplies sanitized flow and settlement.
        </section>
      </main>
    </div>
  );
}
