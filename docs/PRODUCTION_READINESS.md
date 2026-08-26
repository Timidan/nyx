# Nyx Production Readiness

## Verdict

The current source is suitable for a **paused deployment followed by a tiny,
allowlisted mainnet canary**. It is not evidence for unrestricted public
escrow. Deployment, signer custody, hosted monitoring, and real two-wallet
settlement evidence remain external gates.

A second-model adversarial review of this exact source (2026-08-22) returned
NO-GO twice and GO on the third pass. The three defects it found are fixed and
regression-tested:

| Defect | Where | Fix |
|---|---|---|
| The matcher could build a settlement above the contract's 64-order cap, which reverts. Reachable with 33 orders a side inside the canary batch caps. | `agent/src/matcher.ts` | The greedy pair loop stops at `MAX_MATCHED_ORDERS`. Every pair is individually conserving, so truncation stays balanced. |
| Any simulation failure permanently quarantined every candidate order, stranding escrow on a transient oracle band or RPC disagreement. | `agent/src/agent.ts` | Three identical consecutive failures are required before quarantine; a different reason or order set restarts the count. |
| The preflight interpolated untrusted price-feed text into `python3 -c`, so a compromised feed could both force a false green and execute code in the deploy shell. | `scripts/preflight-mainnet.sh` | Every value reaches Python through `argv`; feed prices are rejected unless finite and positive. |

Two follow-ups are recorded rather than fixed. Neither blocks a paused,
allowlisted canary at these caps:

- Classify simulation failures by decoded revert selector instead of message
  equality, so only deterministic order-specific failures quarantine. Required
  before raising any cap or running the agent unattended.
- `START_BLOCK` is validated as positive and not in the future, not as the exact
  deployment block. Verify it by hand before agent startup.

## Implemented in source

| Area | Enforced behavior |
|---|---|
| Oracle | V3 15-minute TWAP adapter, token/decimal normalization, current and harmonic-mean liquidity floors, and spot/TWAP deviation rejection. The constructor also round-trips the pool through the published BDEX factory and reverts unless that factory deployed this exact address for the pair and fee tier. |
| Launch state | Auction deploys paused and allowlisted; both token cap sets are required before unpause. |
| Exposure | Per-order, per-batch, and global escrow caps for each token. Cap changes require a paused auction. |
| User exit | A submitted order commits an expiry. Refund is available on expiry, after its round becomes stale, or after the fallback delay. Pause never disables refunds or claims. |
| Settlement | Exact token conservation, user limit enforcement, oracle band, duplicate protection, maximum 64 matched orders, and cross-side self-trade rejection. |
| Token handling | Exact received-amount reconciliation rejects fee-on-transfer behavior; failed settlement payouts become pull-based claims. |
| Authority | Two-step owner and agent handoffs. The deploy script can start ownership transfer without opening the auction. |
| Agent startup | Exact chain, block range, bytecode hash, tokens, oracle, pool, agent authority, and signer checks. Health fails on drift. |
| Agent send path | One simulation, one transaction submission, confirmed successful receipt, and non-overlapping loop cycles. |
| Quote supply | Provider-authenticated `/quote-requests` exposes public-flow fields only; trader, limit, and salt are omitted. No solver, custody, or hedge dependency is bundled. |
| Web | Mainnet fail-closed mode, canary/paused/cap display, committed expiry, stale/expired refunds, deferred claims, and copyable settlement receipts. |

## Evidence currently available

Full gate re-run on 2026-08-22 against chain 677 at block 20,562,350:

| Suite | Result |
|---|---|
| `forge fmt --check`, `forge lint` | clean |
| `forge test --force` | 45 passed, 0 failed, including two invariants at 128,000 calls each |
| `forge test --match-path test/BotV3TwapOracle.mainnet.t.sol` | 1 passed against live mainnet state |
| `agent`: typecheck, test, build | 49 passed, 0 failed |
| `web`: test, build | 14 passed, 0 failed |
| `scripts/preflight-mainnet.sh` | 11 of 11 checks passed, contract reads pinned to one block |

Live pool facts re-read the same day:

- `getPool(USDT, WBOT, 3000)` on factory `0x1C51c173323ec11BB4e3C4fD2314c225Dc4b5419`
  returns the configured pool, so the configured address is canonical rather
  than one of the two shallower sibling tiers.
- Active liquidity `2.19e19`, 2.43x the configured `9e18` floor, up from
  `1.85e19` at the 2026-08-08 snapshot.
- 1,024 observations, oldest roughly 4.7 hours old, and a working 900-second
  observation.
- Spot within 1.0 bps of the 900-second TWAP.
- Pool TWAP 9.7268 USDT/WBOT against 9.7254 from the BOT Chain DEX feed and
  9.73 on Coinstore, so the pool the oracle reads is the pool BOT Chain's own
  price route uses.

This evidence is about source and current pool compatibility. It does not prove
future pool depth, hosted-process correctness, key custody, or a not-yet-created
deployment. The preflight script's deployment section has never run against a
real deployment, because none exists; run it in a fork before trusting it on
the day.

## Required before the first canary order

- Fresh oracle and auction deployment from the reviewed commit.
- `scripts/preflight-mainnet.sh .env.mainnet` exits zero, run immediately before
  the deployment and again immediately before unpause. Its post-deployment
  branch has never executed against a real deployment, so run it once in a fork
  before relying on it. It also gates on two independent price feeds; waiving
  that with `PREFLIGHT_SKIP_PRICE_CROSSCHECK=1` is a deliberate decision, not a
  default.
- `BOT_V3_FACTORY` set to the published BDEX factory, so a mistyped or seeded
  pool address fails in the oracle constructor rather than at first settlement.
- `paused() == true`, `allowlistEnabled() == true`, expected tokens/oracle/agent,
  intended owner accepted, exact runtime hash pinned, and both cap tuples read
  back from chain.
- Agent `/health` confirms chain, deployment block, code hash, authority, signer,
  oracle, pool, and pause state.
- Owner and agent keys use separate controlled accounts. The agent key is not
  copied into the web host or repository.
- TLS reverse proxy, strict browser origin, body limits, and edge rate limits for
  public `POST /orders`; separate server-only token for `/quote-requests`.
- Durable agent store, process supervision, log retention, RPC-lag alert, and
  escrow/authority monitoring.
- Two distinct allowlisted wallets funded for gas and tiny opposing inventory.
- Pool liquidity, the configured minimum, and the spot/TWAP gap re-read
  immediately before unpause.

## Canary sequence

1. Deploy paused with the `.env.mainnet.example` caps: at most 0.1 WBOT or 1
   USDT per order, 0.5 WBOT or 5 USDT per batch, and 1 WBOT or 10 USDT globally.
2. Keep only the founding trader and quote-provider wallets allowlisted.
3. Start the agent in dry-run mode and confirm deployment verification.
4. Enable signing, unpause, execute one two-wallet matched round, then pause.
5. Reconcile submit events, settlement calldata, received balances, claimable
   balances, escrow accounting, reference price, and settlement hash.
6. Repeat across expiry, stale refund, deferred payout, restart recovery, and
   RPC-failure drills before raising any cap.

## Expansion criteria

Grow counterflow before demand. An auction with users but no opposing quotes
creates locked capital and failed expectations.

| Stage | Admission | Evidence needed to advance |
|---|---|---|
| Founding quotes | 1-3 independent provider wallets | Repeated two-sided clears, no self-flow, predictable response time, reconciled inventory. |
| Trader canary | Small invited cohort | Most eligible orders receive a quote or expire/refund within the displayed window; support and incident paths work. |
| Ecosystem distribution | Wallet/dapp listings and partner campaigns | Stable agent uptime, public receipts, documented caps, and enough quote depth for promoted traffic. |
| Referral loop | Receipt sharing and tracked invitations | Repeat usage exists; incentives cannot be gamed by self-trade or sybil volume. |
| Broader access | Larger allowlist or allowlist removal | Independent review, monitoring history, explicit risk approval, and caps sized from observed liquidity rather than marketing goals. |

The web already supports configurable access/provider application links and
shareable receipts. Those are acquisition surfaces, not evidence that liquidity
exists.

## Monitoring

Alert on:

- `/health.ok != true`, deployment verification changing, or agent authority
  diverging from the configured signer.
- RPC block lag or repeated oracle failures.
- Agent loop latency above `3 * MAX_INTERVAL_SECONDS` while unexpired flow waits.
- Simulation failures, quarantined orders, reverted receipts, or settlement
  submissions without a confirmed successful receipt.
- `totalEscrowed(token)` diverging from open-order accounting.
- Global or batch cap utilization above 80%.
- Spot/TWAP or clearing/TWAP deviation near its configured bound.
- Unexpected pause, allowlist, risk-limit, owner, or agent events.
- Orders expiring without quote-provider acknowledgement.

## Incident response

1. Call `pause()` from the owner account. This stops new escrow and settlement,
   not refunds or payout claims.
2. Preserve `/health`, `/status`, process logs, RPC responses, order-store copy,
   and the affected block range.
3. Publish that unmatched users can refund on expiry/stale round/fallback delay.
4. Reconcile `totalEscrowed`, open orders, claimable balances, and actual token
   balances before any restart.
5. Rotate the agent through `setAgent` / `acceptAgent` if signer compromise is
   plausible. If owner compromise is plausible, keep paused and plan migration.
6. Reopen only after the failure path is reproduced and a capped canary passes.

## Release checks

CI pins pnpm 9.15.9. A newer pnpm with `minimum-release-age` set in the user's
npmrc rejects the frozen install with a spurious overrides mismatch; run the
pinned version rather than regenerating the lockfile.

```bash
scripts/preflight-mainnet.sh .env.mainnet

cd contracts
forge fmt --check
forge lint
forge test --force
MAINNET_RPC_URL=https://rpc.botchain.ai forge test --force \
  --match-path test/BotV3TwapOracle.mainnet.t.sol

cd ../agent
pnpm test
pnpm build

cd ../web
pnpm test
pnpm build

cd ..
bash -n scripts/demo-round.sh scripts/seed-rounds.sh
git diff --check
```

An independent review of the exact commit and deployment parameters is still
recommended before materially increasing the tiny canary limits.
