import { Header } from "./components/Header";
import { AUCTION_ADDRESS, IS_LIVE } from "./lib/config";
import { truncateHash } from "./lib/format";
import { ClearingPulse } from "./components/ClearingPulse";
import { SealOrderPanel } from "./components/SealOrderPanel";
import { AgentStatusPanel } from "./components/AgentStatusPanel";
import { ClearingFeed } from "./components/ClearingFeed";

export default function App() {
  return (
    <div className="min-h-screen bg-ground text-text">
      <Header />

      <main className="mx-auto max-w-6xl space-y-6 px-5 py-8">
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

      <footer className="mx-auto max-w-6xl px-5 pb-10 pt-2 font-mono text-[0.75rem] text-faint">
        {IS_LIVE
          ? `Nyx · BOT Chain testnet · chain 968 · auction ${truncateHash(AUCTION_ADDRESS!)}`
          : "Nyx · BOT Chain testnet · chain 968 · simulated data until deploy"}
      </footer>
    </div>
  );
}
