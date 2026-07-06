# Nyx

**An autonomous on-chain agent that runs sealed-bid batch auctions on BOT Chain and settles them atomically.**

Traders submit sealed orders — a keccak commitment plus ERC-20 escrow — so
order details are invisible to public chain observers while a batch is open.
The Nyx agent watches the pool, reads a live reference price from the real BOT
DEX every cycle, and decides *when* and *why* to clear each batch. Every
settlement emits `BatchSettled(batchId, matchCount, clearingPriceX18, reason,
referencePriceX18, settlementHash)` — the agent's decision, visible on-chain.
Batches close on conditions, not a timer; the explorer stream is the proof.

Built for the **BOT Chain Builder Challenge** — AI Agent track.

## Why the `reason` code matters

An agent that fires every N seconds is a cron job. Nyx clears a batch for one
of five observable reasons, each computed from live on-chain state:

| Code | Trigger |
|---|---|
| 0 | Depth threshold — enough matched orders are waiting |
| 1 | Buy/sell imbalance clears at the BOT DEX midpoint |
| 2 | Escrowed notional exceeded the wait limit |
| 3 | Max interval elapsed (liveness backstop) |
| 4 | Favorable BOT DEX spread movement |

Scroll the explorer: batches settle at irregular intervals for different
reasons. That variance is the autonomy, on the record.

## How it uses BOT Chain

- **Deployed on chain 968** (`rpc.bohr.life`), settling real ERC-20 transfers.
- **The auction trades WBOT/BOUSDT** — the chain's native wrapped token and
  stable pair, not synthetic demo tokens.
- **Reference price read from the live BOT DEX pair**
  (`0x4C7a…a5e0`, BOUSDT/WBOT) every agent cycle; it feeds reason codes 1 and 4
  and is echoed in every `BatchSettled` event as `referencePriceX18`.
- The agent writes continuously: every settlement is an on-chain transaction
  signed by the agent wallet, gated by `onlyAgent`.

## Architecture

```
trader ──seal──▶ NyxBatchAuction (commitment + escrow)
   │                   ▲                    │
   │ preimage          │ settleBatch        │ BatchSettled(reason)
   ▼                   │                    ▼
 Nyx agent ── perceive ─ decide ─ act ─ recover     explorer / web UI
   │
   └── reads BOT DEX pair price every cycle
```

- `contracts/` — Foundry. `NyxBatchAuction`: commit-reveal order pool, agent
  reveal, atomic settlement honoring every order's `minBuyAmount`,
  cancel-with-refund after a delay so funds can never be stranded.
- `agent/` — TypeScript (Node 22, viem). Long-lived loop:
  perceive (events + DEX price) → decide (reason codes) → act
  (simulate-then-settle, gas-bump retry) → recover (rebuilds state from chain
  events on restart). Local API (`:8787`) receives order preimages and serves
  live status to the UI.
- `web/` — Vite + React. Seal orders with any injected wallet, watch the
  clearing pulse (a live render of `BatchSettled` events), see the agent's
  current readings.
- `shared/abi/` — canonical ABI for the frontend. `docs/INTERFACES.md` is the
  frozen contract between all three.

## Run it

```bash
# contracts
cd contracts && forge test          # 7 tests

# agent (dry run needs no key — reads live chain state and prints decisions)
cd agent && pnpm install && pnpm dry-run

# web (simulated data until VITE_AUCTION_ADDRESS is set)
cd web && pnpm install && pnpm dev
```

Full deployment runbook: [docs/DEPLOY.md](docs/DEPLOY.md).

## Deployed artifacts

| Item | Value |
|---|---|
| NyxBatchAuction | [`0x4aD7971C36dae9BF9c81AFC46AaF9A60F6a14777`](https://scan.bohr.life/address/0x4aD7971C36dae9BF9c81AFC46AaF9A60F6a14777) |
| First autonomous settlement | [`0x6a8a55dd…5f4683`](https://scan.bohr.life/tx/0x6a8a55dd60fa4e5863a2070036da113de74681f3f3f075cced4aee7d2c5f4683) — batch 1, reason: imbalance, cleared at 9.66 BOUSDT/WBOT |
| Agent wallet | [`0x253CbCB3A6221E2542516E5CB765C754bf3695b0`](https://scan.bohr.life/address/0x253CbCB3A6221E2542516E5CB765C754bf3695b0) |

## Honest limitations

- The **agent sees order preimages** before clearing; orders are sealed from
  public observers, not from the operator. A ZK settlement layer is the
  natural next step and the contract's event/commitment model was designed so
  one can slot in.
- Single-agent settlement is centralized for the hackathon demo;
  `cancelOrder` guarantees traders can always exit escrow.
- BOT DEX testnet liquidity is small, so demo order sizes are kept tiny.
