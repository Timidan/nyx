# Nyx — Architecture

How the three components fit together and how a sealed order becomes an on-chain
settlement. The contract is the source of truth; the diagrams below trace the
current hardened source (immutable clearing-price guard, two-step agent
rotation), not the older live demo deployment. See
[INTERFACES.md](INTERFACES.md) for exact signatures and
[DEPLOY.md](DEPLOY.md) for the runbook.

## System overview

```mermaid
flowchart LR
  trader["Trader wallet<br/>(injected, EIP-6963)"]
  web["Web UI<br/>(Vite + React, :5190)"]
  auction["NyxBatchAuction<br/>(commit-reveal + escrow)"]
  api["Agent API<br/>(:8787 — /orders, /status)"]
  loop["Agent loop<br/>(perceive, decide, act)"]
  dex["BOT DEX pair<br/>(reference price)"]
  explorer["Blockscout explorer<br/>(scan.bohr.life)"]

  trader -->|"connect + sign"| web
  web -->|"submitOrder: commitment + ERC-20 escrow"| auction
  web -->|"POST /orders: reveal preimage"| api
  api -->|"verify vs on-chain order, store"| loop
  loop -->|"getReserves every cycle"| dex
  loop -->|"read events, settleBatch"| auction
  auction -->|"OrderSettled, BatchSettled events"| explorer
  web -->|"GET /status: decision trace"| api
  web -.->|"verify tx + events"| explorer
```

A trader connects a wallet to the web UI, which submits the on-chain commitment
plus token escrow to `NyxBatchAuction` and then hands the matching reveal
preimage to the agent's local API — the commitment goes on-chain, the preimage
never does. The agent loop reads the BOT DEX pair for a live reference price
every cycle and reads auction events, then signs `settleBatch`. The web UI polls
`/status` for the agent's decision trace and links out to the explorer so every
claim is independently verifiable.

## Settlement sequence

```mermaid
sequenceDiagram
    actor Trader
    participant Web as Web UI
    participant Auction as NyxBatchAuction
    participant Agent as Nyx agent
    participant DEX as BOT DEX pair
    participant Explorer

    Trader->>Web: place hidden order (side, amount, limit)
    Web->>Auction: submitOrder(batchId, commitment, sellToken, sellAmount)
    Auction-->>Explorer: OrderSubmitted
    Web->>Agent: POST /orders (reveal preimage)
    Agent->>Auction: getOrder(commitment)
    Note over Agent: reveal must match the submitted order, else rejected

    loop every AGENT_POLL_MS
        Agent->>DEX: getReserves (reference price)
        Agent->>Auction: currentBatchId, getReferencePriceX18
        Note over Agent: decide() picks reason 0..4 or none
    end

    alt reason fires and an exact-conserving set exists
        Agent->>Auction: simulate settleBatch
        Agent->>Auction: settleBatch(batchId, clearingPriceX18, reason, matches)
        Auction-->>Trader: transfer bought tokens (OrderSettled each)
        Auction-->>Explorer: BatchSettled(reason, clearingPriceX18, referencePriceX18, settlementHash)
        Auction-->>Explorer: BatchOpened(nextBatchId)
    else no trigger or no balanced set
        Note over Agent: keep watching
    end

    Web->>Agent: GET /status (decision trace, lastTx)
    Web->>Explorer: verify settlement tx
```

Sealing is two messages: the commitment and escrow land on-chain, then the
preimage is POSTed to the agent, which rejects any reveal that does not match
the stored on-chain order. On each cycle the agent reads the DEX reference price
and current batch, then evaluates its reason codes. When a reason fires and a
balanced, in-band settlement exists, the agent simulates first and only then
signs `settleBatch`, which pays out every matched order and emits `BatchSettled`
with the reason and settlement hash for the UI and explorer.

## Order lifecycle

```mermaid
stateDiagram-v2
    [*] --> Submitted: submitOrder (commitment + escrow)
    Submitted --> Settled: settleBatch (matched, exact-conserving)
    Submitted --> Cancelled: cancelOrder (after cancelDelaySeconds)
    Submitted --> Refundable: its round settles without it
    Refundable --> Cancelled: cancelOrder (after cancelDelaySeconds)
    Settled --> [*]
    Cancelled --> [*]

    note right of Submitted
        cancelOrder reverts until
        block.timestamp >= submittedAt + cancelDelaySeconds
    end note
    note right of Refundable
        Still on-chain status SUBMITTED, but its batch
        is no longer current, so it can never settle —
        the trader exits escrow via cancelOrder.
    end note
```

An order lives on-chain as one of four statuses: `NONE`, `SUBMITTED`, `SETTLED`,
`CANCELLED`. `submitOrder` escrows the funds and marks it `SUBMITTED`; from there
it either gets matched into a `settleBatch` and becomes `SETTLED`, or the trader
reclaims escrow with `cancelOrder`. `cancelOrder` is guarded by the cancel delay
(`block.timestamp >= submittedAt + cancelDelaySeconds`), which guarantees an exit
even if the agent never settles. Orders are scoped to their round — once their
batch advances unmatched they are effectively "refundable": still `SUBMITTED`
on-chain but no longer settleable, so the only remaining move is `cancelOrder`.

## Agent loop

```mermaid
flowchart TD
  tick(["Loop tick — every AGENT_POLL_MS"]) --> perceive
  perceive["Perceive<br/>DEX reserves + reference price,<br/>currentBatchId, queued reveals"] --> decide
  decide{"Decide — first matching reason wins"}
  decide -->|"0 depth, 1 imbalance, 2 notional,<br/>3 max-interval, 4 dex-spread"| build
  decide -->|"no trigger"| watch["Watch — wait for next tick"]
  build["Build exact-conserving settlement<br/>within maxClearingDeviationBps"]
  build -->|"no balanced set / no agent key"| watch
  build -->|"candidate found"| simulate["Simulate settleBatch"]
  simulate -->|"reverts"| quarantine["Quarantine matches"] --> watch
  simulate -->|"ok"| send["Send settleBatch<br/>gas-bump retry x2 (+25% per try)"]
  send -->|"receipt confirmed"| mark["Mark settled,<br/>reset interval + last reason"] --> watch
  send -->|"all retries fail"| errored["Record error state"] --> watch
  watch --> tick
  restart(["Restart / init"]) -.->|"rebuild state from chain events"| perceive
```

Every tick the agent perceives (DEX price, current batch, queued reveals),
decides (the five reason codes evaluated in priority order, first match wins, or
none), then acts. Acting means building an exactly token-conserving settlement
within the clearing-price band, simulating it, and only then sending — a
simulation revert quarantines the offending matches instead of broadcasting a
doomed transaction, and sends are retried with a rising gas bump. On restart the
loop rebuilds its view of every order from on-chain events before it resumes, so
a crash never loses or double-settles state.
