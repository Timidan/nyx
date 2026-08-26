import type { ReactNode } from "react";
import { AmbientLayers } from "./components/AmbientLayers";
import { StatusBar } from "./components/StatusBar";
import { ThemeToggle } from "./components/ThemeToggle";
import { BotChainMark, UsdtMark, WbotMark } from "./components/TokenMarks";
import { Window } from "./components/Window";
import { CHAIN_LABEL, IS_MAINNET } from "./lib/chain";
import { AUCTION_ADDRESS } from "./lib/config";
import { addressUrl } from "./lib/format";
import { REASON_BG, reasonWords } from "./lib/reasons";

/**
 * Landing page at "/". Same tokens, chrome and motion budget as the desk, so
 * arriving here and opening /app feels like one program.
 *
 * No hero instrument. The desk already owns every visualisation this product
 * needs (ClearingPulse for market history, NightSky for the network,
 * TraceMeter for trigger progress); a hero animation competes with the real
 * application and loses. The fold is a statement, and the windows below carry
 * the substance.
 *
 * The chain figures are a dated reading, not a live feed. Nothing is deployed
 * on mainnet, so live hooks here would render a page of em-dashes; a verified
 * block-stamped fact is both more useful and more honest. The footer carries
 * the block and the date.
 */

/** Read from https://rpc.botchain.ai with scripts/preflight-mainnet.sh. */
const READING = { block: "20,562,350", date: "2026-08-22" };

const POOL = "0x64F418471a1A7932a190E10da5A8551dB5AbeC05";
const FACTORY = "0x1C51c173323ec11BB4e3C4fD2314c225Dc4b5419";

const REASON_RULES: Record<number, { name: string; rule: string }> = {
  0: { name: "Queue depth", rule: "Enough orders wait." },
  1: { name: "Side balance", rule: "Buys and sells offset." },
  2: { name: "Queued value", rule: "Enough value queued." },
  3: { name: "Liveness", rule: "Too long since the last round." },
  4: { name: "Spread", rule: "Market moved toward waiting traders." },
};

export function Landing() {
  return (
    <div className="flex min-h-screen flex-col text-text">
      <AmbientLayers />

      <header className="sticky top-0 z-20 border-b-2 border-border bg-surface">
        <div className="mx-auto flex h-[52px] max-w-6xl items-center gap-4 px-4 sm:px-5">
          <a
            href="#top"
            className="font-pixel text-[1.1875rem] tracking-[0.08em] text-text"
          >
            NYX
          </a>
          <nav className="ml-auto flex items-center gap-0.5">
            <NavLink href="#how" hideOnSmall>
              How it works
            </NavLink>
            <NavLink href="#chain">Addresses</NavLink>
            <NavLink href="#limits" hideOnSmall>
              Limits
            </NavLink>
            <ThemeToggle />
          </nav>
        </div>
      </header>

      <main id="top" className="mx-auto w-full max-w-6xl flex-1 px-4 sm:px-5">
        <section className="py-14 sm:py-16">
          <h1 className="max-w-[19ch] text-balance font-display text-[clamp(2.4rem,6.6vw,4.9rem)] font-semibold leading-[1.05] tracking-[-0.015em]">
            Sealed-limit batch auctions on BOT&nbsp;Chain
          </h1>
          <p className="mt-5 max-w-[62ch] text-[1.0625rem] leading-relaxed text-muted">
            Orders wait with their limit price sealed. When a round clears,
            every matched order settles at <b className="font-medium text-text">one price</b>, in one
            transaction, with a receipt on chain.
          </p>
          <div className="mt-7 flex flex-wrap gap-3.5">
            <a
              href="/app"
              className="btn95 inline-flex items-center justify-center bg-navy px-[18px] py-2.5 text-[0.9375rem] font-medium text-white hover:brightness-110"
            >
              Open the trading desk
            </a>
            <a
              href="#chain"
              className="btn95 inline-flex items-center justify-center bg-surface px-[18px] py-2.5 text-[0.9375rem] font-medium text-text hover:bg-surface-2"
            >
              Read the addresses
            </a>
          </div>
        </section>

        <Band id="how" title="Why a round clears" sub="The agent picks the moment. The contract still has to agree.">
          <Window title="decide.exe" bodyClassName="">
            <ul>
              {[0, 1, 2, 3, 4].map((code, i) => (
                <li
                  key={code}
                  className={`grid grid-cols-[14px_minmax(0,1fr)] items-center gap-x-3.5 gap-y-1 px-4 py-2.5 transition-colors duration-150 hover:bg-surface-2 sm:grid-cols-[14px_13ch_minmax(0,1fr)_auto] ${
                    i < 4 ? "border-b-2 border-border" : ""
                  }`}
                >
                  <span className={`h-3.5 w-3.5 border border-border ${REASON_BG[code]}`} />
                  <span className="font-medium">{REASON_RULES[code].name}</span>
                  <span className="col-start-2 text-muted sm:col-start-3">
                    {REASON_RULES[code].rule}
                  </span>
                  <span
                    className="col-start-2 font-mono text-[0.6875rem] text-faint sm:col-start-4"
                    title={reasonWords(code)}
                  >
                    reason {code}
                  </span>
                </li>
              ))}
            </ul>
          </Window>
        </Band>

        <Band
          id="chain"
          title="Where it runs"
          sub={
            IS_MAINNET
              ? "Two shallower WBOT/USDT pools exist. The oracle only accepts the one the BDEX factory deployed."
              : "The oracle only accepts a pool the BDEX factory deployed for the pair and fee tier."
          }
        >
          <Window title="proof.exe" bodyClassName="">
            <Row>
              <Cell label="chain">
                <BotChainMark /> {CHAIN_LABEL}
              </Cell>
              <Cell label="base token">
                <WbotMark /> WBOT · 18
              </Cell>
              <Cell label="quote token">
                <UsdtMark /> USDT · 6
              </Cell>
              <Cell label="auction">{AUCTION_ADDRESS ? "deployed" : "not deployed"}</Cell>
            </Row>
            {IS_MAINNET && (
              <Row bordered>
                <Cell label="canonical pool · fee 3000">
                  <Hex address={POOL} />
                </Cell>
                <Cell label="factory that proves it">
                  <Hex address={FACTORY} />
                </Cell>
                <Cell label="pool liquidity">2.19e19 · 2.43× floor</Cell>
                <Cell label="spot vs 900s TWAP">1.0 bps</Cell>
              </Row>
            )}
          </Window>
          <p className="mt-2.5 font-mono text-[0.6875rem] text-faint">
            {IS_MAINNET
              ? `Chain figures read at block ${READING.block} on ${READING.date}. Prices move; re-run scripts/preflight-mainnet.sh rather than trusting this line.`
              : "This build is not pointed at BOT Chain mainnet, so the mainnet canary pool and oracle readings are withheld."}
          </p>
        </Band>

        <Band
          id="limits"
          title="What the canary allows"
          sub="The mainnet canary ceilings, in raw units. Changing one requires a paused auction."
        >
          <div className="grid gap-5 md:grid-cols-3">
            <Window title="wbot.exe">
              <h3 className="flex items-center gap-2.5 font-display text-[1.0625rem] font-semibold">
                <WbotMark /> WBOT
              </h3>
              <Caps rows={[["per order", "0.1"], ["per round", "0.5"], ["global escrow", "1.0"]]} />
            </Window>
            <Window title="usdt.exe">
              <h3 className="flex items-center gap-2.5 font-display text-[1.0625rem] font-semibold">
                <UsdtMark /> USDT
              </h3>
              <Caps rows={[["per order", "1"], ["per round", "5"], ["global escrow", "10"]]} />
            </Window>
            <Window title="access.exe">
              <h3 className="font-display text-[1.0625rem] font-semibold">Access</h3>
              <Caps
                rows={[
                  ["wallets on the allowlist", "2"],
                  ["matched per settlement", "64"],
                  ["state at deploy", "paused"],
                ]}
              />
            </Window>
          </div>
        </Band>

        <Band title="The receipt" sub="One price and one hash for every order that cleared together.">
          <div className="grid gap-5 md:grid-cols-2">
            <Window title="receipt.exe" bodyClassName="p-4">
              <Code>
                <b className="font-medium text-text">BatchSettled</b>{"(\n  batchId, matchCount,\n  "}
                <b className="font-medium text-text">clearingPriceX18</b>
                {",\n  reason, referencePriceX18,\n  "}
                <b className="font-medium text-text">settlementHash</b>
                {"\n)"}
              </Code>
            </Window>
            <Window title="preflight.exe" bodyClassName="p-4">
              <Code>
                {"$ scripts/preflight-mainnet.sh\n  "}
                <span className="text-settle">ok</span>
                {"  factory confirms the pool\n  "}
                <span className="text-settle">ok</span>
                {"  spot within 500bps of TWAP\n"}
                <b className="font-medium text-text">11 checks passed.</b>
              </Code>
            </Window>
          </div>
        </Band>

        <section className="pb-11">
          <Window title="notice.exe" bodyClassName="p-4">
            <div className="flex items-start gap-3.5">
              <span aria-hidden="true" className="mt-px font-pixel text-[1.375rem] leading-none text-alert">
                !
              </span>
              <p className="text-muted">
                <b className="font-medium text-text">Nyx is not a dark pool.</b> Wallet, side, size
                and escrow are public on submission. Only the limit price and its salt wait.
                {IS_MAINNET && AUCTION_ADDRESS ? "" : " Nothing is deployed on mainnet yet."}
              </p>
            </div>
          </Window>
        </section>
      </main>

      <StatusBar />
    </div>
  );
}

function NavLink({
  href,
  children,
  hideOnSmall = false,
}: {
  href: string;
  children: ReactNode;
  hideOnSmall?: boolean;
}) {
  return (
    <a
      href={href}
      className={`tap95 border-2 border-transparent px-2.5 py-1.5 text-[0.8125rem] text-text hover:bg-navy hover:text-white ${
        hideOnSmall ? "hidden sm:inline-block" : ""
      }`}
    >
      {children}
    </a>
  );
}

function Band({
  id,
  title,
  sub,
  children,
}: {
  id?: string;
  title: string;
  sub: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="pb-11 pt-4">
      <h2 className="font-display text-[1.5rem] font-semibold">{title}</h2>
      <p className="mb-5 mt-2 max-w-[64ch] text-muted">{sub}</p>
      {children}
    </section>
  );
}

function Row({ children, bordered = false }: { children: ReactNode; bordered?: boolean }) {
  return (
    <div
      className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 ${
        bordered ? "border-t-2 border-border" : ""
      }`}
    >
      {children}
    </div>
  );
}

function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-b-2 border-border px-4 py-3.5 last:border-b-0 sm:border-r-2 sm:last:border-r-0 lg:border-b-0">
      <dt className="mb-1.5 font-mono text-[0.6875rem] text-faint">{label}</dt>
      <dd className="flex items-center gap-2 font-mono text-[0.8125rem]">{children}</dd>
    </div>
  );
}

function Hex({ address }: { address: string }) {
  return (
    <a
      href={addressUrl(address)}
      target="_blank"
      rel="noreferrer"
      title={address}
      className="border-b border-link text-link transition-colors duration-150 hover:bg-surface-2"
    >
      {address.slice(0, 6)}…{address.slice(-4)}
    </a>
  );
}

function Caps({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="mt-3.5 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2.5">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-[0.9375rem] text-muted">{k}</dt>
          <dd className="text-right font-mono text-[0.875rem] tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Code({ children }: { children: ReactNode }) {
  return (
    <pre className="m-0 whitespace-pre-wrap break-words font-mono text-[0.78125rem] leading-[1.75] text-muted">
      {children}
    </pre>
  );
}
