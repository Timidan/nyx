# HACKATHON.md — Requirements Brief & Submission Checklist

> Single source of truth for what the BOT Chain Builder Challenge requires and
> what is done. Created Phase 1 (recon) Jul 6; updated through the build; run as
> a hard gate before submission.

---

## 1. Event

| Field | Value |
|---|---|
| Hackathon / bounty name | BOT Chain Builder Challenge #1 (5,000 USDT pool, 7-day online) |
| Platform | Google Forms + Builders Telegram (t.me/BOTChainBuilders) |
| **Registration form (required first)** | https://forms.gle/TgXQaPopPkJkm8Va6 |
| **Submission form** | https://forms.gle/ZEU6B4SDXvZAjs9T8 |
| Chosen track | **AI Agent** — "AI Agents, automated execution, or on-chain interaction demos on BOT Chain" (verbatim fit) |
| Why this track | Autonomous agent is the only actor driving the contracts; continuous on-chain usage |
| **Deadline (event TZ)** | **Jul 8, 23:59 UTC+8** (judging Jul 8–15, results Jul 15) |
| **Deadline (my TZ)** | **Jul 8, ~16:59 Lagos (UTC+1)** — target finish Jul 8 morning with buffer |

---

## 2. Sources of rules

| Source | URL | Read? | Notes / conflicts |
|---|---|---|---|
| **Official rules (full text)** | `hackathon details.md` (pasted Jul 6 evening) | ✅ | **Binding.** Confirms plan's rubric/deadline/tweet/form fields exactly; adds registration form, native-weighting, fair-play rules |
| Team recon doc | `nyx-botchain-plan.md` | ✅ | Matched official rules on every mandatory item |
| Official dev docs | dev-docs.botchain.ai quick-guide | ✅ fetched | **Testnet = chainId 968, rpc.bohr.life, scan.bohr.life (officially documented)**; mainnet = 677, botchain.ai family |
| BOT Chain infra | rpc.bohr.life / scan.bohr.life | ✅ probed + used | Deployed + settling on the documented testnet |

Rules-diff findings vs what we built (Jul 6 late):
- ✅ Rubric 35/25/20/20, deadline, tweet spec, submission fields — plan matched official text exactly.
- ⚠️ **Registration form must be completed before submitting** (Step 1) — user action.
- ➕ "Native BOT Chain projects score higher … deep use of BOT Chain's capabilities" — we qualify strongly (agent reads the live BOT DEX pair every cycle as decision input, auction trades the native WBOT/BOUSDT pair, continuous agent-signed txs). Write-up must foreground this; RPC-swap-only projects are explicitly down-weighted.
- ➕ Fair play: no fake demos/txs/data. Our demo rounds are real on-chain settlements with real tokens; the write-up discloses that early demo orders were seeded by the team while the agent settled them autonomously.
- ➕ Demo video **or** live demo link acceptable (no length mandate; 2–3 min stays our target).
- ➕ Open source "recommended", not mandatory — public repo still the practical choice (form asks for GitHub).
- ➕ AI coding tools explicitly encouraged (Claude Code named); must be able to explain + demo the implementation.
- ➕ Bounty submissions go through the same submission form with issue fields (title, repro, impact, proposed fix, contact + wallet).

---

## 3. Requirements (the load-bearing part)

| Weight | Requirement | What satisfies it | Status | Evidence (where a judge sees it) |
|---|---|---|---|---|
| MANDATORY | Registration + Builders Telegram | Both team members registered & joined | ☐ | — |
| MANDATORY | Genuine deployment on BOT Chain 968 | Contracts deployed, real verifiable txs | ✅ Jul 6 | `NyxBatchAuction` `0x4aD7971C36dae9BF9c81AFC46AaF9A60F6a14777`; autonomous settlement tx `0x6a8a55dd…5f4683` on scan.bohr.life |
| MANDATORY | X showcase tweet tagging **@BOTChain_ai** | Name + what it solves + BOT Chain usage + screenshot/demo link + GitHub + track | ☐ | Tweet URL in submission |
| MANDATORY | Submission form, every field | Name, track, summary, demo, repo, contract addr, tx hash, write-up, next steps, X link | ☐ | Form |
| MANDATORY | Demo video 2–3 min | Shows agent self-triggering + settlement verifying on-chain; show the explorer | ☐ | Video link |
| WEIGHTED 35% | BOT Chain Integration | Agent continuously reads/writes chain 968 every cycle; on-chain reference price read | ☐ | Explorer activity stream |
| WEIGHTED 25% | Product Completeness | E2E working flow: seal order → agent clears batch → funds settle | ☐ | Live demo + video |
| WEIGHTED 20% | Innovation | Autonomous sealed-batch auction agent; `BatchSettled(reason)` on-chain decision transparency | ☐ | Explorer events + write-up |
| WEIGHTED 20% | Presentation | Demo video, UI, write-up | ☐ | Video + live link |
| BONUS | Best Content award | Build story / demo content (Miracle's lane) | ☐ | X post |
| BONUS | PR/Bug/Optimization bounty | Doc gaps logged with repro + proposed fix | ☐ | Write-ups |

> ✅ All former open questions resolved by the official rules (Jul 6):
> - Submission form: https://forms.gle/ZEU6B4SDXvZAjs9T8 (fields confirmed, §Submission)
> - Demo video **or** live demo link — either satisfies
> - Faucet: https://faucet.botchain.ai/basic (bohr.life faucet already used successfully)
>
> ⚠️ Remaining user actions: complete the **registration form** (https://forms.gle/TgXQaPopPkJkm8Va6) and join t.me/BOTChainBuilders before submitting.

---

## 4. Required deliverables

| Deliverable | Constraint | Status | Link |
|---|---|---|---|
| Deployed contracts on 968 | Real verifiable txs | ✅ | `0x4aD7971C…4777`; settlements incl. `0x6a8a55dd…4683`, `0xa717…2bd2` |
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
- Jul 6 evening: contracts + agent built and tested (7/7 forge tests). **Deployed to 968 same day** once faucet funds landed; agent settling autonomously since.
- Jul 6 night: 7 rounds settled across 4 distinct reason codes; full UI E2E completed with a real third-party wallet (Rabby) — user order sealed via UI, matched, settled in round #6 (`0xa717…2bd2`). Two real wallet-flow bugs found and fixed via live browser testing (EIP-6963 multi-wallet connect; wallet-chain detection). UI reskinned to modernized Win95 per user direction, copy humanized.
- Bounty note (doc gaps to write up): the published SwapRouter is a Uniswap **V3** SwapRouter though the DEX presents as V2 pairs (`getAmountsOut` reverts); BOUSDT mint is role-restricted; faucet has no API. Repro + fixes → PR bounty lane.
