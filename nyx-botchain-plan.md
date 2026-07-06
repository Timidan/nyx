# Nyx — BOT Chain Builder Challenge Build Plan

Working name: **Nyx** (Greek goddess of night: autonomous, private, short, brandable). Swappable. Alternates: Umbra, Vesper, Sable.

One-line positioning: **An autonomous on-chain agent that runs private batch auctions and settles them trustlessly.** The dark pool is the mechanism underneath, not the pitch. Crossed is an internal template for the ZK settlement layer only.

- **Track:** AI Agent (automated execution + on-chain interaction).
- **Chain:** BOT Chain testnet, Chain ID 968, RPC + explorer at bohr.life family. Geth-compatible, so standard precompiles are present and the Groth16 verifier works unchanged.
- **Deadline:** Jul 8, 23:59 UTC+8 (about 17:00 Jul 8 Lagos). Roughly two working days from now.

---

## 1. Why this scores

The rubric weights BOT Chain Integration at 35%, Product Completeness 25%, Innovation 20%, Presentation 20%. Three moves cover all four:

1. The agent is the only actor that drives the contracts, and it reads a live price from BOT DEX every cycle. That continuous on-chain usage is the 35% integration score.
2. Every batch the agent closes emits `BatchSettled(batchId, matchCount, clearingPrice, reason)` where `reason` encodes *why it fired*. A judge scrolling the explorer sees batches closing at varying intervals for different reasons. That single event kills the "relabeled cron job" suspicion and carries both Innovation and Presentation.
3. The ZK settlement means even the agent cannot move funds without a valid proof. That is the trust story, kept separate from the autonomy story so neither muddies the other.

Do **not** bolt on an LLM. Autonomous execution qualifies for the track on its own, and a fragile last-minute chatbot wrapper reads as decoration. The autonomy is the AI story.

---

## 2. Architecture

**Three contracts, agent-driven:**

- `OrderPool` — accepts sealed commitments (Poseidon notes), pulls ERC-20 into escrow keyed by commitment, emits `OrderSubmitted`.
- `Settlement` + `Verifier` — verifies the Groth16 proof via the BN254 precompile, burns nullifiers, executes atomic swaps, checkpoints the Merkle root. Funds move only on a valid proof.
- Decision transparency lives in the `BatchSettled` event, not a separate contract.

**Off-chain agent (the star):** perceive, decide, act, recover. Runs as a long-lived process (put it on the Proxmox homelab alongside Hermes so it is genuinely always-on for the demo window).

**Frontend:** minimal. Submit a sealed order, watch the clearing feed, see agent status. The explorer stream is half the demo, so the UI does not need to carry everything.

**Carries over from Crossed unchanged:** the circuit, the proving pipeline, note/nullifier/Merkle model, midpoint logic. **New work:** the Solidity settlement contract, the DEX reference read, the decision policy, the frontend. Keep on-chain Poseidon near zero (store commitments as raw field elements, only checkpoint the root) or gas eats your two days.

---

## 3. Two-day schedule with owners

**Timidan:** contracts, agent, ZK path. **Miracle:** frontend, demo video, Best Content, bounty write-ups.

### Day 0 — setup (a few hours, tonight)
- [ ] Register + join Builders Telegram (both).
- [ ] Add BOT testnet (Chain ID 968) to wallet, pull faucet tokens.
- [ ] Repo scaffold, lock the name, drop in this design system.
- [ ] Regenerate the Solidity `Groth16Verifier` from the existing circuit with snarkjs. No circuit changes.
- [ ] Miracle: stand up the frontend shell with the tokens below so Day 2 is wiring, not styling.

### Day 1 — contracts + ZK path (Timidan)
- [ ] `OrderPool.sol`, `Settlement.sol`, wire in the verifier.
- [ ] Deploy a test ERC-20 pair for escrow.
- [ ] Deploy all to testnet 968 with Foundry.
- [ ] **Milestone that de-risks everything: land one real end-to-end settlement tx where the proof verifies on-chain.** If this works, the hard part is done. Save the tx hash.

### Day 2 — agent + frontend + submission
- [ ] Timidan: agent loop (section 5), BOT DEX price read, `BatchSettled(reason)` logging, self-restart recovery.
- [ ] Miracle: wire order submission, the clearing feed, agent status panel to the deployed contracts.
- [ ] Let the agent run live under varying conditions so the explorer shows non-uniform batches.
- [ ] Miracle: record the 2-3 min demo (show the explorer stream, not just UI clicks).
- [ ] X showcase tweet tagging **@BOTChain_ai** (required, no tweet means no judging).
- [ ] Submission form, every field (section 7).
- [ ] Miracle: log doc gaps hit during setup for the bounty.

---

## 4. Contract interfaces

```solidity
// OrderPool.sol
event OrderSubmitted(bytes32 indexed commitment, address indexed token, uint256 escrowed);
function submitOrder(bytes32 commitment, address token, uint256 amount) external; // pulls via transferFrom

// Settlement.sol
event BatchSettled(uint256 indexed batchId, uint256 matchCount, uint256 clearingPrice, uint8 reason);
// reason: 0 depth-threshold, 1 imbalance, 2 notional-wait, 3 max-interval, 4 dex-spread-trigger
function settleBatch(
    uint256 batchId,
    uint256[8] calldata proof,      // Groth16 a/b/c packed
    uint256[] calldata publicSignals,
    Match[] calldata matches,
    bytes32 newRoot
) external onlyAgent;

// Verifier.sol — snarkjs output, untouched
function verifyProof(uint[2] a, uint[2][2] b, uint[2] c, uint[] input) external view returns (bool);
```

`onlyAgent` keeps a clean "one autonomous actor" story for judges. The proof, not the modifier, is what actually protects funds.

---

## 5. Agent loop skeleton

```
loop every tick:
  # perceive
  pending   = read OrderSubmitted events since last batch
  dexPrice  = read reference price from BOT DEX for the pair   # strongest native hook
  state     = { depth, buySellImbalance, notionalWaiting, secsSinceLastClear }

  # decide  (transparent weighted policy, real inputs, non-obvious output)
  if depth >= DEPTH_MIN:                    reason = 0
  elif imbalance clears at dexPrice midpoint: reason = 1
  elif notionalWaiting >= NOTIONAL_MAX:     reason = 2
  elif secsSinceLastClear >= MAX_INTERVAL:  reason = 3
  elif dexSpread favorable:                 reason = 4
  else: wait; continue

  # act
  witness = buildWitness(pending, dexPrice)
  proof   = prove(witness)                  # reuse Crossed circuit, server-side, no browser proving
  tx      = settleBatch(batchId, proof, signals, matches, newRoot)
  log(reason, clearingPrice, matchCount)

  # recover
  on restart: rebuild state from on-chain events + last checkpointed root
  on failed tx: retry with gas bump
```

The point of the `reason` branches is that batches close on *conditions*, not a fixed timer. That is the whole difference between an agent and a cron job, and it is visible on-chain.

---

## 6. Design system

Settled direction, so no UI debate. Everything below is copy-ready.

### Direction

The obvious move for a dark pool is near-black plus one acid-green accent. That is the default AI-crypto look, so we are not doing it. Nyx reads as a **night-observatory instrument**: the agent watches its environment and acts. Ground is deep midnight blue, not black. Two signal colors map to the agent's actual state: cool cyan when it is perceiving and deciding, warm amber when it has acted and settled. Monospace is load-bearing because the entire product is on-chain data.

**Signature element:** the **clearing pulse** — a live horizontal timeline of batches. Each settled batch is a pulse whose height is match count and whose label is the on-chain `reason`. It is literally a render of the `BatchSettled` event, so the memorable UI element and the winning contract event are the same thing.

### Tokens

```css
:root {
  /* ground + surfaces */
  --ground:     #0B1020;  /* deep midnight, never pure black */
  --surface:    #141B2E;
  --surface-2:  #1C2540;
  --border:     #263258;

  /* text */
  --text:       #E8ECF6;
  --text-muted: #8A97B4;
  --text-faint: #55628A;

  /* signal: cool = perceiving/deciding (live) */
  --signal:     #46D0D9;
  --signal-dim: #2A7A80;

  /* settle: warm = acted/settled (done) */
  --settle:     #F5A65B;
  --settle-dim: #7A5230;

  /* alert: nullifier burn / failure, used sparingly */
  --alert:      #E5687A;

  /* radii + motion */
  --r-input: 4px;
  --r-card:  6px;
  --r-panel: 8px;
  --pulse: 220ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
```

### Typography

Load from Google Fonts.

- **Display / headings:** Space Grotesk, 600–700. Characteristic, not another Inter hero.
- **Body / UI:** Inter, 400–500.
- **Data / mono:** JetBrains Mono, 400–500 for addresses, hashes, prices, sizes, the whole on-chain stream.

Scale (rem): 0.75 caption, 0.875 body, 1 base, 1.25 h3, 1.75 h2, 2.5 h1. Mono is used at 0.8125 for dense data rows. Numbers in the clearing feed use tabular figures (`font-variant-numeric: tabular-nums`).

### Tailwind config sketch

```js
theme: {
  extend: {
    colors: {
      ground: '#0B1020', surface: '#141B2E', 'surface-2': '#1C2540',
      border: '#263258', text: '#E8ECF6', muted: '#8A97B4', faint: '#55628A',
      signal: '#46D0D9', settle: '#F5A65B', alert: '#E5687A',
    },
    fontFamily: {
      display: ['"Space Grotesk"', 'sans-serif'],
      sans: ['Inter', 'sans-serif'],
      mono: ['"JetBrains Mono"', 'monospace'],
    },
    borderRadius: { input: '4px', card: '6px', panel: '8px' },
  },
}
```

### Component recipes

- **Primary button (Submit sealed order):** `bg-signal text-ground font-medium rounded-input px-4 py-2 hover:brightness-110 active:brightness-95`. One primary action per view.
- **Secondary:** `border border-border text-text bg-surface rounded-input px-4 py-2 hover:border-signal`.
- **Ghost:** `text-muted hover:text-text`.
- **Card / panel:** `bg-surface border border-border rounded-card p-5`. Agent panel gets `rounded-panel` and a 1px top border in `--signal-dim` when the agent is live.
- **Data row:** `font-mono text-[0.8125rem] tabular-nums`, addresses truncated `0x1234…abcd`, hashes link out to the explorer in `--signal`.
- **Agent status pill:** three states, color-coded. `Watching` (muted), `Deciding` (signal, subtle pulse), `Settling` (settle). Show the last `reason` in plain words and the current heuristic reading.
- **Clearing pulse (signature):** horizontal track, one bar per batch, height ∝ match count, fill `--settle`, a `--pulse` grow animation on new settlement. Hover shows `batchId`, `clearingPrice`, `reason`, tx link. This is the hero of the page.
- **Toast:** submitted (muted), settled (settle), failed (alert). Errors state what happened and what to do, in the interface's voice, no apology.

### Motion

One orchestrated moment: the clearing pulse animating in on each settlement. Everything else stays still. Respect `prefers-reduced-motion` (drop the grow, keep the color change).

### UI copy voice

Name things by what the user controls. The button says "Seal order," and the toast says "Order sealed." Settlement says "Batch cleared," never "Transaction succeeded." The agent speaks in plain readings: "Waiting: depth 3 of 8," "Cleared: buy/sell imbalance at DEX midpoint." Sentence case, active voice, no filler.

---

## 7. Mandatory submission checklist

Nothing here is optional. This is the part that lost Mantle.

- [ ] Registered + in Builders Telegram.
- [ ] Genuinely deployed on BOT Chain, real verifiable tx. Save **contract address** and **tx hash**.
- [ ] **X showcase tweet tagging @BOTChain_ai.** Required for judging. Include: name + what it solves + how it uses BOT Chain + demo screenshot/link + GitHub + track.
- [ ] Submission form, every field: project name, track (AI Agent), summary, demo video or live link, GitHub repo, contract address, tx hash or on-chain screenshot, technical write-up, next steps, X link.
- [ ] Demo video 2-3 min, shows the ZK proof verifying and the agent self-triggering. Show the explorer.

---

## 8. Stacked awards (do all three)

The categories are independent and stack.

- **Track Award (AI Agent):** the build above.
- **Best Content (10 slots):** Miracle's lane. A strong build story or demo video is a clean second shot. No em dashes, first-person builder voice, the established style.
- **PR / Bug / Optimization Bounty (50-100 each, up to 900):** their docs are thin. Log every gap, broken faucet, or unclear config you hit during setup, with reproduction steps and a proposed fix. Complaints without a fix are not paid, so always propose the solution.

---

## 9. Cut list if behind

Protect the milestone (one real on-chain proof settlement) above all. If Day 2 runs short, cut in this order:

1. Partial fills — settle full matches only.
2. Frontend polish — the explorer stream plus a plain agent-status readout is a valid demo on its own.
3. The DEX price read as a *trigger* — keep it as a *displayed reference* if wiring the trigger gets fragile, but say so honestly in the write-up.

Never cut: real deployment, a verifiable settlement tx, the `BatchSettled(reason)` event, the tagged X tweet.
