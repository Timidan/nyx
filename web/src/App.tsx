import { Header } from "./components/Header";
import { AUCTION_ADDRESS, IS_LIVE } from "./lib/config";
import { truncateHash } from "./lib/format";
import { ClearingPulse } from "./components/ClearingPulse";
import { SealOrderPanel } from "./components/SealOrderPanel";
import { AgentStatusPanel } from "./components/AgentStatusPanel";
import { ClearingFeed } from "./components/ClearingFeed";

export default function App() {
  return (
    <div className="flex min-h-screen flex-col bg-ground text-text">
      <Header />

      <main className="mx-auto w-full max-w-6xl flex-1 space-y-6 px-5 py-8">
        <ClearingPulse />

        <div className="grid gap-6 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <SealOrderPanel />
          </div>
          <div className="lg:col-span-3">
            <AgentStatusPanel />
          </div>
        </div>

        <ClearingFeed />
      </main>

      <footer className="border-t-2 border-border bg-ground px-5 py-2">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 font-mono text-[0.75rem] text-muted">
          <span className="sunken95 px-2 py-0.5 font-pixel text-[0.625rem] leading-none text-text">
            Nyx
          </span>
          <span className="sunken95 px-2 py-0.5">BOT Chain testnet · chain 968</span>
          <span className="sunken95 px-2 py-0.5">
            {IS_LIVE
              ? `auction ${truncateHash(AUCTION_ADDRESS!)}`
              : "simulated data until deploy"}
          </span>
        </div>
      </footer>
    </div>
  );
}
