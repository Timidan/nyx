# Nyx Feature Ideas

Review date: July 6, 2026

The current implementation is already a credible BOT Chain AI Agent track
submission: deployed auction contract, commit-reveal escrow, autonomous
settlement reasons, BOT DEX reference pricing, agent API, and live frontend
wiring. The strongest demo moment is the on-chain `BatchSettled` event carrying
`reason`, `referencePriceX18`, and `settlementHash`, rendered in the clearing
pulse UI.

## Highest-ROI Additions

1. Decision Trace Panel

   Show exactly why the agent is leaning toward settlement:

   - queue depth
   - side notional
   - imbalance bps
   - wait time
   - BOT DEX reference price
   - active threshold

   Most inputs already exist in `agent/src/policy.ts` and `agent/src/agent.ts`.
   This makes the "not a cron job" story easy for judges to verify.

2. My Orders + Cancel Flow

   Track the connected user's submitted commitments in local storage, read
   status through `getOrder`, show reveal delivery state, and expose
   `cancelOrder` once the delay passes.

   The contract already supports refunds, and the frontend already handles
   reveal retry. This improves product completeness without changing the
   deployed contract.

3. Multi-Order Batch Matching

   The contract can settle multiple matched orders in one batch, but the agent
   currently finds one complementary pair. Extending the matcher to settle
   several exact complementary pairs would make `matchCount` and the clearing
   pulse more compelling.

   This has more implementation risk than UI additions, but it strengthens the
   "batch auction" claim.

4. Judge Proof Panel

   Add a compact proof strip with:

   - auction contract address
   - agent wallet
   - current batch
   - BOT DEX pair
   - last settlement tx
   - settlement hash
   - explorer links

   This directly supports the BOT Chain integration and presentation criteria.

5. Demo Seeder Script

   Add a `pnpm demo:round` script that submits tiny complementary orders and
   POSTs their reveals to the agent. `docs/DEPLOY.md` already has the manual
   version; automating it makes the demo repeatable under deadline pressure.

## Non-Feature Cleanup

`HACKATHON.md` still has unchecked deliverables and older build-state wording
that says deployment was blocked, while `README.md` now lists deployed
artifacts. Sync it before submission so the repo does not contradict itself.

## Avoid For This Deadline

- Do not add an LLM wrapper just to look more like "AI".
- Do not revive the ZK path before submission.
- Do not add new external services unless they serve a specific step in the
  existing demo flow.

The best use of remaining time is stronger observability around the autonomous
on-chain behavior that already exists.
