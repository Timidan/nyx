import { Header } from "./components/Header";
import { AgentStatusPanel } from "./components/AgentStatusPanel";
import { AmbientLayers } from "./components/AmbientLayers";
import { ClearingFeed } from "./components/ClearingFeed";
import { ClearingPulse } from "./components/ClearingPulse";
import { MyOrdersPanel } from "./components/MyOrdersPanel";
import { SealOrderPanel } from "./components/SealOrderPanel";
import { StatusBar } from "./components/StatusBar";
import { NightSky } from "./components/NightSky";
import { Landing } from "./Landing";

/** Path-based routing without a router lib: "/app" is the trading desk,
 *  everything else (including "/") is the landing page. Navigation between
 *  the two is plain <a href> full-page loads. The interactive night-sky
 *  canvas rides behind both routes (dark theme only). */
export default function App() {
  const path = window.location.pathname;
  const isDesk = path === "/app" || path.startsWith("/app/");
  return (
    <>
      <NightSky />
      {isDesk ? <Desk /> : <Landing />}
    </>
  );
}

/** The trading desk (the original single-page app), unchanged. */
function Desk() {
  return (
    // The root stays transparent so the ambient layer shows on the ground;
    // the body carries the ground color.
    <div className="flex min-h-screen flex-col text-text">
      {/* ambient retro background: drifting pixel checker, starfield,
          dark-mode scanlines, and a pixel shooting star every ~25s.
          All layers sit behind the windows. */}
      <AmbientLayers />

      <Header />

      <main className="mx-auto w-full max-w-6xl flex-1 space-y-6 px-4 py-8 sm:px-5">
        <ClearingPulse />

        <div className="grid gap-6 lg:grid-cols-5">
          <div className="space-y-6 lg:col-span-2">
            <SealOrderPanel />
            <MyOrdersPanel />
          </div>
          <div className="lg:col-span-3">
            <AgentStatusPanel />
          </div>
        </div>

        <ClearingFeed />
      </main>

      <StatusBar />
    </div>
  );
}
