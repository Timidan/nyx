# HACKATHON.md — Requirements Brief & Submission Checklist

> Single source of truth for what the BOT Chain Builder Challenge requires and
> what is done. Created Phase 1 (recon) Jul 6; updated through the build; run as
> a hard gate before submission.

---

## 1. Event

| Field | Value |
|---|---|
| Hackathon / bounty name | BOT Chain Builder Challenge |
| Platform | Telegram-coordinated (no public listing indexed; rules per team recon in `nyx-botchain-plan.md`) |
| Submission / BUIDL page URL | _confirm in Builders Telegram_ |
| Chosen track | **AI Agent** (automated execution + on-chain interaction) |
| Why this track | Autonomous agent is the only actor driving the contracts; continuous on-chain usage |
| **Deadline (event TZ)** | **Jul 8, 23:59 UTC+8** |
| **Deadline (my TZ)** | **Jul 8, ~16:59 Lagos (UTC+1)** — target finish Jul 8 morning with buffer |

---

## 2. Sources of rules

| Source | URL | Read? | Notes / conflicts |
|---|---|---|---|
| Team recon doc | `nyx-botchain-plan.md` | ✅ | Primary source; encodes rubric + mandatory list |
| Public web listing | — | ✅ searched | Not indexed anywhere; event is Telegram/X-coordinated |
| Builders Telegram pinned rules | _confirm_ | ☐ | **User action: re-verify mandatory list against pinned post** |
| BOT Chain infra | rpc.bohr.life / scan.bohr.life | ✅ probed | RPC live, chainId 968 confirmed, ~sub-second blocks, gas ~47 gwei |

---

## 3. Requirements (the load-bearing part)

| Weight | Requirement | What satisfies it | Status | Evidence (where a judge sees it) |
|---|---|---|---|---|
| MANDATORY | Registration + Builders Telegram | Both team members registered & joined | ☐ | — |
| MANDATORY | Genuine deployment on BOT Chain 968 | Contracts deployed, real verifiable txs | ☐ | Contract address + tx hash on scan.bohr.life |
| MANDATORY | X showcase tweet tagging **@BOTChain_ai** | Name + what it solves + BOT Chain usage + screenshot/demo link + GitHub + track | ☐ | Tweet URL in submission |
| MANDATORY | Submission form, every field | Name, track, summary, demo, repo, contract addr, tx hash, write-up, next steps, X link | ☐ | Form |
| MANDATORY | Demo video 2–3 min | Shows agent self-triggering + settlement verifying on-chain; show the explorer | ☐ | Video link |
| WEIGHTED 35% | BOT Chain Integration | Agent continuously reads/writes chain 968 every cycle; on-chain reference price read | ☐ | Explorer activity stream |
| WEIGHTED 25% | Product Completeness | E2E working flow: seal order → agent clears batch → funds settle | ☐ | Live demo + video |
| WEIGHTED 20% | Innovation | Autonomous sealed-batch auction agent; `BatchSettled(reason)` on-chain decision transparency | ☐ | Explorer events + write-up |
| WEIGHTED 20% | Presentation | Demo video, UI, write-up | ☐ | Video + live link |
| BONUS | Best Content award | Build story / demo content (Miracle's lane) | ☐ | X post |
| BONUS | PR/Bug/Optimization bounty | Doc gaps logged with repro + proposed fix | ☐ | Write-ups |

> ⚠️ Open questions to confirm in Builders Telegram:
> - Exact submission form URL + field list
> - Whether a live demo URL is required or video suffices
> - Faucet location for chain 968 test tokens

---

## 4. Required deliverables

| Deliverable | Constraint | Status | Link |
|---|---|---|---|
| Deployed contracts on 968 | Real verifiable txs | ☐ | |
| Public GitHub repo | Public, README with setup | ☐ | |
| Demo video | 2–3 min, shows explorer + agent self-triggering | ☐ | |
| X tweet | Tags @BOTChain_ai, all required content | ☐ | |
| Submission form | Every field | ☐ | |
| Technical write-up | Honest about what's live vs scaffolded | ☐ | |

---

## 5. Access & credits (day one)

| Item | Needed for | Requested? | Received? | Fallback |
|---|---|---|---|---|
| Faucet tokens (chain 968) | Deployment + agent gas | ☐ | ☐ | Ask in Telegram; without gas nothing ships — **top priority user action** |
| BOT DEX address/pair | Reference price read (35% integration story) | ✅ found on-chain | ✅ | **RESOLVED**: BOT DEX V2 pair BOUSDT/WBOT live + actively traded at `0x4C7a5bE488491A76b2839AcCFc13d8Dd5276a5e0` (token0 BOUSDT `0xAfea2A5e0587615ceD6972e271E5bfe8622ebcA2`, token1 WBOT `0xD5452816194a3784dBa983426cCe7c122F4abd30`). Second pair `0xC5EAf0…`, SwapRouter `0x07032d47A1b9f8460cBeE9dC17c1d3E438693929` |

---

## 6. Rubric → evidence map

| Rubric criterion | Weight | Where the judge sees it | Gap? |
|---|---|---|---|
| BOT Chain Integration | 35% | Explorer: continuous agent txs, DEX price reads, varied batch settlements | until deployed |
| Product Completeness | 25% | Live e2e: seal → clear → settle; demo video | until built |
| Innovation | 20% | `BatchSettled(batchId, matchCount, clearingPrice, reason)` — visible non-cron autonomy | until deployed |
| Presentation | 20% | Demo video + night-observatory UI + clearing-pulse hero | until recorded |

---

## 7. Phase 3 — final verification gate

- [ ] Every MANDATORY item met and demonstrated
- [ ] Contracts live on 968, tx hashes saved and load in explorer from fresh session
- [ ] Repo public with README
- [ ] Demo video 2–3 min, accessible, shows explorer + agent self-triggering
- [ ] X tweet posted tagging @BOTChain_ai (no tweet = no judging)
- [ ] Submission form complete, correct track (AI Agent)
- [ ] Submitted with hours of buffer, not minutes

**Verdict:** _pending_

---

## Build-state notes (kept honest)

- **Crossed ZK codebase does not exist locally or on GitHub** — plan §2 "carries over unchanged" is void.
- **Scope decision (Jul 6, post-ideation): commit-reveal sealed-batch auction, no ZK.** Recorded with rationale in `docs/INTERFACES.md`.
- Jul 6 evening: contracts + agent **built and tested** (7/7 forge tests, agent dry-run against live RPC read reference price 9.6977 BOUSDT/WBOT). Frontend shell built and verified; live wiring in progress. **Deployment blocked solely on faucet funding** (both wallets 0 BOT). Deploy runbook: `docs/DEPLOY.md`.
- Bounty note (doc gaps to write up): the published SwapRouter is a Uniswap **V3** SwapRouter though the DEX presents as V2 pairs (`getAmountsOut` reverts); BOUSDT mint is role-restricted; faucet has no API. Repro + fixes → PR bounty lane.
