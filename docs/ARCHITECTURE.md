# Nyx Architecture

Nyx has four required runtime pieces: trader web, escrow auction, matching
agent, and a narrow V3 oracle adapter. Quote providers are optional independent
participants, not a privileged solver layer.

## End-to-end data flow

```mermaid
flowchart LR
  wallet[Trader wallet]
  web[Web desk]
  auction[NyxBatchAuction]
  api[Agent API]
  loop[Matching agent]
  oracle[BotV3TwapOracle]
  pool[USDT/WBOT V3 pool]
  qp[Independent quote provider]
  explorer[Chain explorer]

  wallet -->|sign approve + submitOrder| web
  web -->|commitment, public side/size, escrow, expiry| auction
  web -->|private reveal delivery| api
  api -->|validate commitment + persist| loop
  loop -->|read reference price| auction
  auction -->|priceX18| oracle
  oracle -->|observe, liquidity, slot0| pool
  loop -->|simulate once, submit once| auction
  auction -->|events and receipt| explorer
  qp -->|authenticated sanitized flow read| api
  qp -->|own complementary order| auction
```

Dependency boundaries are intentional:

- The V3 pool supplies observations; it does not settle user orders.
- The agent supplies timing and matching; the contract enforces value safety.
- The quote-provider feed supplies sanitized demand awareness; it does not
  custody inventory, choose provider risk, or execute hedges.
- The browser stores only its own recent order records and an undelivered
  reveal until committed expiry. Chain state remains canonical.

## Order sequence

```mermaid
sequenceDiagram
    actor Trader
    participant Web
    participant Auction
    participant Agent
    participant Oracle
    participant V3 as V3 pool

    Trader->>Web: side, base amount, limit
    Web->>Auction: read pause, allowlist, caps, batch, cancel delay
    Web->>Web: expiresAt = latest block + min(UI TTL, cancel delay)
    Web->>Auction: hashOrder(reveal)
    Web->>Auction: approve exact sell amount
    Web->>Auction: submitOrder(batch, commitment, token, amount, expiry)
    Auction-->>Web: confirmed OrderSubmitted
    Web->>Agent: POST reveal preimage
    Agent->>Auction: hashOrder + getOrder
    Note over Agent: reject mismatch, stale status, wrong batch, or expiry

    loop one non-overlapping cycle
        Agent->>Auction: current batch + getReferencePriceX18
        Auction->>Oracle: priceX18
        Oracle->>V3: observe(window, now), liquidity, slot0
        Agent->>Agent: discard expired flow, choose trigger, build exact set
    end

    alt valid complementary set
        Agent->>Auction: simulate settleBatch
        Agent->>Auction: one buffered-gas settleBatch transaction
        Auction-->>Trader: transfer bought token or credit claimable payout
        Auction-->>Web: OrderSettled + BatchSettled receipt
    else no safe set
        Agent->>Agent: keep watching without a transaction
    end
```

The reveal is hidden from public observers only while waiting. The matching
agent sees it after delivery, and successful settlement calldata publishes it.

## Contract controls

```mermaid
flowchart TD
  submit[submitOrder] --> open{not paused?}
  open -->|no| reject1[revert]
  open -->|yes| allow{allowlisted if enabled?}
  allow -->|no| reject1
  allow -->|yes| expiry{future expiry within fallback delay?}
  expiry -->|no| reject1
  expiry -->|yes| caps{per-order, batch, global caps?}
  caps -->|no| reject1
  caps -->|yes| exact{exact ERC-20 amount received?}
  exact -->|no| reject1
  exact -->|yes| escrow[record order and escrow]

  settle[settleBatch] --> setchecks{1-64, current, unexpired, unique, no cross-side self-trade}
  setchecks -->|fail| reject2[revert whole settlement]
  setchecks -->|pass| oraclecheck{TWAP + liquidity + deviation available?}
  oraclecheck -->|fail| reject2
  oraclecheck -->|pass| invariant{limits and exact token conservation?}
  invariant -->|fail| reject2
  invariant -->|pass| payout[settle atomically; defer only failed outbound payout]
```

The auction starts paused. Risk limits and allowlist mode can change only while
paused. Pause blocks new submissions and settlements but never blocks user
refunds or payout claims.

## Order lifecycle

```mermaid
stateDiagram-v2
    [*] --> Submitted: submitOrder + escrow + expiresAt
    Submitted --> Settled: matched before expiry
    Submitted --> Refundable: expiresAt reached
    Submitted --> Refundable: batch advanced unmatched
    Submitted --> Refundable: fallback cancel delay elapsed
    Refundable --> Cancelled: cancelOrder refunds escrow
    Settled --> Paid: transfer succeeds
    Settled --> Claimable: transfer fails
    Claimable --> Paid: claimPayout
```

`Refundable` and `Claimable` are explanatory states, not additional contract
status values. A refundable order remains `SUBMITTED` until cancellation; a
claimable order is already `SETTLED`.

## Agent lifecycle

```mermaid
flowchart TD
  boot[Start] --> identity{chain, block, bytecode, tokens, oracle, pool, authority, signer match?}
  identity -->|no| unhealthy[fail health and refuse operation]
  identity -->|yes| recover[recover events and actual last settlement timestamp]
  recover --> tick[non-overlapping loop tick]
  tick --> perceive[read batch, TWAP, queue; drop expired orders]
  perceive --> decide[apply reason policy]
  decide -->|none or no exact set| tick
  decide -->|candidate| simulate[simulate settleBatch]
  simulate -->|revert| quarantine[quarantine invalid candidate] --> tick
  simulate -->|success| send[estimate once, add 25% gas limit, send once]
  send --> receipt{confirmed success receipt?}
  receipt -->|yes| mark[record tx and settlement state] --> tick
  receipt -->|no| unhealthy
```

The agent does not replay an ambiguously submitted settlement with a gas-bump
loop. Recovery reads chain events, so local restart state cannot overwrite the
contract's settlement truth.

## Authority and failure model

- Owner controls pause, caps, allowlist, and agent nomination. Ownership and
  agent changes are two-step acceptances.
- Agent can choose when and which safe complementary set to settle. It cannot
  transfer arbitrary escrow or bypass limits/oracle/expiry.
- Oracle depends on V3 observations and liquidity. Unavailability fails closed,
  which can stop settlement; expiry and cancellation remain available.
- A malicious or offline agent can censor settlement until users refund. It
  cannot prevent expiry/stale/fallback cancellation.
- A compromised owner can change controls or nominate an agent. Use separate
  controlled custody and monitor every authority/configuration event.
