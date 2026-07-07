import { useEffect, useState, type ReactNode } from "react";
import { AmbientLayers } from "./components/AmbientLayers";
import { ClearingPulse } from "./components/ClearingPulse";
import { MonitorIcon, OrderPadIcon, SealIcon } from "./components/Icons";
import { ProofStrip } from "./components/ProofStrip";
import { StatusBar } from "./components/StatusBar";
import { ThemeToggle } from "./components/ThemeToggle";
import { Window } from "./components/Window";
import { useAgentState } from "./hooks/useAgentState";
import { useBatches } from "./hooks/useBatches";
import { AUCTION_ADDRESS } from "./lib/config";
import { addressUrl } from "./lib/format";
import { REASON_BG, reasonWords } from "./lib/reasons";
import type { AgentStatus } from "./types";

/** The deployed NyxBatchAuction; the landing links it even in mock mode. */
const CONTRACT =
  AUCTION_ADDRESS ?? "0x58126ae8ff411a3B1768b121763a0E999221b6da";

const AGENT_LABEL: Record<AgentStatus, { label: string; dot: string; text: string }> = {
  watching: { label: "Watching", dot: "bg-muted", text: "text-muted" },
  deciding: { label: "Deciding", dot: "bg-signal", text: "text-signal" },
  settling: { label: "Settling", dot: "bg-settle", text: "text-settle" },
};

/**
 * Landing page at "/" — brand register, same token system as the desk.
 * The live stats strip and the activity chart read real chain/agent data
 * through the existing hooks, which already degrade gracefully.
 */
export function Landing() {
  const { data: batches = [], isLoading: batchesLoading } = useBatches();
  const { data: agent } = useAgentState();
  const latest = batches.length > 0 ? batches[batches.length - 1] : undefined;
  const agentMeta = agent?.live ? AGENT_LABEL[agent.status] : null;

  return (
    <div className="flex min-h-screen flex-col text-text">
      <AmbientLayers />
      {/* landing-only atmospheric field: static glows + vignette + grain,
          beneath the shared ambient layers */}
      <div aria-hidden="true" className="landing-atmo" />
      <BootFlash />

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
            <a
              href="/app"
              className="tap95 inline-flex items-center font-mono text-[0.75rem] text-link underline hover:no-underline"
            >
              Open the desk
            </a>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-10 sm:px-5">
        {/* hero */}
        <section aria-labelledby="hero-heading" className="py-12 text-center sm:py-16">
          <div className="relative">
            {/* dark-only mint halo + glow line behind the wordmark */}
            <div aria-hidden="true" className="hero-halo" />
            <h1
              id="hero-heading"
              className="font-pixel text-[clamp(3.25rem,9vw,6rem)] leading-none text-text"
            >
              Nyx
            </h1>
          </div>
          <p className="mt-5 font-display text-[1.25rem] font-semibold text-text sm:text-[1.5rem]">
            Hidden orders. Autonomous settlement. On-chain proof.
          </p>
          <p className="mx-auto mt-3 max-w-2xl text-balance font-mono text-[0.8125rem] leading-relaxed text-muted">
            A sealed-bid batch auction on BOT Chain, run end to end by an
            agent. Orders stay hidden until they clear; every settlement is a
            public receipt.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <a
              href="/app"
              className="btn95 inline-flex items-center justify-center bg-navy px-5 py-2.5 text-[0.9375rem] font-medium text-white hover:brightness-110"
            >
              Open the trading desk
            </a>
            <a
              href={addressUrl(CONTRACT)}
              target="_blank"
              rel="noreferrer"
              className="btn95 inline-flex items-center justify-center gap-2 bg-surface px-5 py-2.5 text-[0.9375rem] font-medium text-text"
            >
              View the contract ↗
            </a>
          </div>
        </section>

        {/* live stats strip: real readings from the chain + agent */}
        <section
          aria-label="Live readings"
          className="flex flex-wrap justify-center gap-2"
        >
          <Stat
            label="rounds settled"
            value={batchesLoading ? "—" : String(batches.length)}
          />
          <Stat
            label="last clearing price"
            value={latest ? latest.clearingPrice.toFixed(4) : "—"}
            valueClass={latest ? "text-settle" : "text-faint"}
          />
          <Stat
            label="market price (BOT DEX)"
            value={agent?.dexPrice != null ? agent.dexPrice.toFixed(4) : "—"}
            valueClass={agent?.dexPrice != null ? "text-settle" : "text-faint"}
          />
          <Stat
            label="agent"
            value={
              agentMeta ? (
                <span className={`flex items-center gap-1.5 ${agentMeta.text}`}>
                  <span
                    className={`crt-glow h-2 w-2 border border-border ${agentMeta.dot} ${agentMeta.text}`}
                  />
                  {agentMeta.label}
                </span>
              ) : (
                "agent offline"
              )
            }
            valueClass={agentMeta ? "" : "text-faint"}
          />
        </section>

        {/* live chart: the same settled rounds the desk renders */}
        <section aria-label="Agent activity" className="mt-10">
          <ClearingPulse />
        </section>

        {/* how it works */}
        <section aria-labelledby="how-heading" className="mt-10">
          <h2
            id="how-heading"
            className="font-display text-[1.5rem] font-semibold text-text"
          >
            How it works
          </h2>
          <div className="mt-4 grid gap-6 md:grid-cols-3">
            <Window title="seal.exe" icon={<OrderPadIcon />}>
              <h3 className="font-display text-[1.125rem] font-semibold text-text">
                1. Seal
              </h3>
              <p className="mt-2 font-mono text-[0.75rem] leading-relaxed text-muted">
                Place a hidden order from the desk. The contract stores a
                commitment and escrows your funds. Amount and price stay
                hidden until the round clears.
              </p>
            </Window>
            <Window title="decide.exe" icon={<MonitorIcon />}>
              <h3 className="font-display text-[1.125rem] font-semibold text-text">
                2. Decide
              </h3>
              <p className="mt-2 font-mono text-[0.75rem] leading-relaxed text-muted">
                An autonomous agent watches orders waiting, buy and sell
                balance, value queued, time since the last round, and the
                market price on BOT DEX. The first condition met settles the
                round:
              </p>
              <ul className="mt-3 space-y-1.5">
                {[0, 1, 2, 3, 4].map((code) => (
                  <li
                    key={code}
                    className="flex items-center gap-2 font-mono text-[0.6875rem] text-muted"
                  >
                    <span
                      className={`h-2.5 w-2.5 shrink-0 border border-border ${REASON_BG[code]}`}
                    />
                    {reasonWords(code)}
                  </li>
                ))}
              </ul>
            </Window>
            <Window title="settle.exe" icon={<SealIcon />}>
              <h3 className="font-display text-[1.125rem] font-semibold text-text">
                3. Settle
              </h3>
              <p className="mt-2 font-mono text-[0.75rem] leading-relaxed text-muted">
                One atomic transaction swaps every matched order at a single
                clearing price and leaves a receipt on the explorer. Orders
                that do not clear can be cancelled for a full refund.
              </p>
            </Window>
          </div>
        </section>

        {/* deployed contracts — the full proof window */}
        <section className="mt-10">
          <ProofStrip />
        </section>
      </main>

      <StatusBar />
    </div>
  );
}

function Stat({
  label,
  value,
  valueClass = "text-text",
}: {
  label: string;
  value: ReactNode;
  valueClass?: string;
}) {
  return (
    <div className="sunken95 flex items-center gap-2 px-3 py-1.5 font-mono text-[0.75rem]">
      <span className="text-faint">{label}</span>
      <span className={`tabular-nums ${valueClass}`}>{value}</span>
    </div>
  );
}

/**
 * Win95 boot flash: a static text screen for 1.2s on the first landing visit
 * per session. sessionStorage-gated; skipped entirely under
 * prefers-reduced-motion. No animation, just a timed unmount.
 */
function BootFlash() {
  const [show, setShow] = useState<boolean>(() => {
    try {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches)
        return false;
      return sessionStorage.getItem("nyx.booted") === null;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (!show) return;
    try {
      sessionStorage.setItem("nyx.booted", "1");
    } catch {
      // storage blocked — the flash simply shows once per load
    }
    const t = setTimeout(() => setShow(false), 1200);
    return () => clearTimeout(t);
  }, [show]);

  if (!show) return null;
  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 z-50 bg-ground p-6 font-mono text-[0.8125rem] text-text"
    >
      <p className="font-pixel text-[1.375rem] leading-none">Nyx</p>
      <p className="mt-4">BOT Chain testnet · chain 968</p>
      <p className="mt-1 text-muted">reading the chain</p>
    </div>
  );
}
