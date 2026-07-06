import { NyxAgent } from "./agent.js";
import { loadConfig } from "./config.js";
import { startHttpServer } from "./http.js";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const once = args.has("--once");
const noServer = args.has("--no-server");

const config = loadConfig({ dryRun });
const agent = new NyxAgent(config);

await agent.init();

if (!noServer) {
  startHttpServer(agent, config);
}

if (once) {
  await agent.runOnce();
  process.exit(0);
}

await agent.startLoop();
