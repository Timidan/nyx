<div align="center">

<img src="docs/assets/nyx-logo.svg" alt="Nyx" width="380" />

**Sealed-bid batch auctions on BOT Chain, run and settled by an autonomous agent.**

[![Chain](https://img.shields.io/badge/BOT_Chain-testnet_968-1418A8)](https://scan.bohr.life/address/0x58126ae8ff411a3B1768b121763a0E999221b6da)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.30-363636?logo=solidity)](contracts/)
[![Foundry](https://img.shields.io/badge/tests-Foundry-orange)](contracts/test/)
[![TypeScript](https://img.shields.io/badge/agent-TypeScript_%2B_viem-3178C6?logo=typescript&logoColor=white)](agent/)
[![React](https://img.shields.io/badge/web-React_%2B_Vite-61DAFB?logo=react&logoColor=black)](web/)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

[Quickstart](#quickstart) · [How it works](#how-it-works) · [On-chain integration](#on-chain-integration) · [Repo map](#repo-map) · [Architecture](docs/ARCHITECTURE.md) · [Deploying](docs/DEPLOY.md) · [Protocol reference](docs/INTERFACES.md)

<img src="docs/assets/nyx-ui.png" alt="Nyx trading interface: agent activity bars, hidden-order desk, decision trace, and settled rounds" width="850" />

</div>

---

Traders submit **hidden orders**: a keccak commitment plus ERC-20 escrow, so
order details are invisible to chain observers while a round is open. The Nyx
agent watches the pool, reads a live reference price from the BOT DEX every
cycle, and decides *when* and *why* to clear each round. Every settlement is
an atomic on-chain swap that emits
`BatchSettled(batchId, matchCount, clearingPriceX18, reason, referencePriceX18, settlementHash)`:
the agent's decision, on the record.

Rounds close on conditions, not a timer. The agent fires for one of five
observable reasons, each computed from live on-chain state:

| Code | Trigger |
|---|---|
| 0 | Enough orders queued (depth threshold) |
| 1 | Buys and sells match at the BOT DEX midpoint |
| 2 | Enough value queued (notional threshold) |
| 3 | Time limit reached (liveness backstop) |
| 4 | Market moved in traders' favor (DEX spread) |

The result is a settlement stream with irregular cadence and varied triggers,
verifiable block by block on the explorer.

## How it works

```
trader ──seal──▶ NyxBatchAuction (commitment + escrow)
   │                   ▲                    │
   │ preimage          │ settleBatch        │ BatchSettled(reason)
   ▼                   │                    ▼
 Nyx agent ── perceive ─ decide ─ act ─ recover     explorer / web UI
   │
   └── reads the BOT DEX pair price every cycle
```

For detailed system, settlement-sequence, order-lifecycle, and agent-loop
diagrams, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

- **`contracts/`** — Foundry. `NyxBatchAuction`: commit-reveal order pool,
  agent reveal, atomic settlement with exact token conservation
  (`sold0 == bought0 && sold1 == bought1`), per-order `minBuyAmount`
  enforcement, and cancel-with-refund after a delay so funds can never be
  stranded.
- **`agent/`** — TypeScript (Node 22, viem). A long-lived loop: perceive
  (events + DEX price) → decide (the five reason codes, in priority order) →
  act (simulate, then settle; gas-bump retry) → recover (rebuilds state from
  chain events on restart). Settles multiple matched orders per round at a
  single clearing price when the queue allows. Serves a local HTTP API
  (`:8787`) that receives order preimages and exposes live status, including
  a full decision trace.
- **`web/`** — Vite + React. Place hidden orders with any injected wallet
  (EIP-6963 multi-wallet discovery), watch rounds settle in real time, track
  and cancel your own orders, and verify everything through explorer links.
  Falls back to a simulator when no contract address is configured.

## On-chain integration

- The auction trades **WBOT/BOUSDT**, the chain's native wrapped token and
  stable pair, not synthetic demo tokens.
- The reference price is read from the live BOT DEX pair
  ([`0x4C7a…a5e0`](https://scan.bohr.life/address/0x4C7a5bE488491A76b2839AcCFc13d8Dd5276a5e0))
  every agent cycle; it feeds reason codes 1 and 4 and is echoed in every
  `BatchSettled` event as `referencePriceX18`.
- Every settlement is a transaction signed by the agent wallet, gated by
  `onlyAgent` on the contract.

### Deployed (BOT Chain testnet, chain 968)

The current deployment includes the immutable clearing-price deviation guard
and two-step agent rotation.

| Item | Value |
|---|---|
| `NyxBatchAuction` | [`0x58126ae8ff411a3B1768b121763a0E999221b6da`](https://scan.bohr.life/address/0x58126ae8ff411a3B1768b121763a0E999221b6da) |
| Agent wallet | [`0xF62b9CEc835D125771898C73aeF05357855Cdc19`](https://scan.bohr.life/address/0xF62b9CEc835D125771898C73aeF05357855Cdc19) |
| Deploy tx | [`0xe8e0338f…9d40f`](https://scan.bohr.life/tx/0xe8e0338f6dfa524599b8c147d5f3fa94613e8896347480ae15f014a00059d40f) |
| Settlement proof | [`0xaab7dd6a…9b94`](https://scan.bohr.life/tx/0xaab7dd6ab9039d041ef98bc8358709ddf706e54878158cae418e6fc0d5a39b94) |

An earlier instance (`0x4aD7971C…4777`, before the deviation guard and two-step
rotation) settled the first live rounds; see git history.

## Quickstart

Prerequisites: [Foundry](https://getfoundry.sh), Node ≥ 22.13, pnpm.

```bash
# 1. contracts — run the test suite
cd contracts && forge test

# 2. agent — typecheck, unit tests, and a read-only dry run against the live
#    chain (prints the perceive/decide cycle; needs no private key)
cd agent
pnpm install
pnpm test
pnpm dry-run

# 3. web — simulated data out of the box; set VITE_AUCTION_ADDRESS in
#    web/.env.local to point at a live deployment
cd web
pnpm install
pnpm dev        # http://localhost:5190
```

Environment variables are documented in [.env.example](.env.example). Private
keys are never stored in files; export them in the shell that runs a
deployment or the agent (see [docs/DEPLOY.md](docs/DEPLOY.md)).

To deploy your own instance end to end (deploy → authorize agent → first
settlement), follow [docs/DEPLOY.md](docs/DEPLOY.md). To drive a scripted
demo round against a running deployment: `scripts/demo-round.sh`.

## Repo map

| Path | What lives there |
|---|---|
| `contracts/` | Foundry project: `NyxBatchAuction`, interface, deploy script, tests |
| `agent/` | The autonomous agent: policy, matcher, chain IO, HTTP API, tests |
| `web/` | React UI: order desk, agent monitor, activity feed |
| `shared/abi/` | Canonical contract ABI consumed by the frontend |
| `scripts/` | `demo-round.sh`: submit a matched order set and watch it settle |

## Security model and limitations

- Current source enforces an immutable max clearing-price deviation against
  the BOT DEX reference price at settlement time, and agent rotation is a
  two-step `setAgent` / `acceptAgent` handoff.
- **The agent sees order preimages before clearing.** Orders are sealed from
  public observers, not from the operator. A ZK settlement layer is the
  natural next step; the event and commitment model was designed so one can
  slot in without changing the order flow.
- **Single-agent settlement is centralized** in the current deployment.
  `cancelOrder` guarantees traders can always exit escrow after the cancel
  delay, whether or not the agent cooperates.
- Orders are scoped to the round they were submitted in; unmatched orders
  from a closed round are refundable, not carried over.
- Testnet DEX liquidity is small, so reference prices move visibly with
  modest swaps.

## License

[MIT](LICENSE)
