# Nyx Mainnet Canary Runbook

This runbook deploys the V3 TWAP oracle and `NyxBatchAuction` to BOT Chain
mainnet (chain 677). It intentionally ends with the auction **paused**. A
deployment transaction is not authorization to accept public escrow.

Private keys stay in the invoking shell. Do not put them in `.env`, process
manager files, CI logs, or this repository.

## 1. Prepare and verify the inputs

```bash
cp .env.mainnet.example .env.mainnet
# Fill OWNER_ADDRESS, AGENT_ADDRESS, INITIAL_ALLOWED_TRADER,
# INITIAL_QUOTE_PROVIDER, and the later deployment-output fields.

set -a
source .env.mainnet
set +a

# Read-only. Re-reads every chain fact below and exits non-zero on any
# mismatch. Never broadcasts, never touches a key.
scripts/preflight-mainnet.sh .env.mainnet
```

Run the same script again after deployment and once more immediately before
unpause. It picks up the deployment checks as soon as `NYX_BATCH_AUCTION` is
filled in. A passing snapshot is evidence about the block it ran on, not about
the block the canary opens on.

Expected chain and pool identity, verified on 2026-08-08 and re-verified on
2026-08-22 at block 20,562,350:

| Item | Value |
|---|---|
| Chain ID | `677` |
| Pool | `0x64F418471a1A7932a190E10da5A8551dB5AbeC05` |
| Pool token0 | USDT `0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C` (6 decimals) |
| Pool token1 | WBOT `0xD5452816194a3784dBa983426cCe7c122F4abd30` (18 decimals) |
| Fee / spacing | 3,000 / 60 |
| Factory | `0x1C51c173323ec11BB4e3C4fD2314c225Dc4b5419` (published in the BOT Chain integration guide) |
| Observation cardinality | 1,024 |
| Active liquidity | `2.19e19`, 2.43x the configured `9e18` floor |
| Spot vs 900s TWAP | 1.0 bps |
| Price cross-check | 9.7268 USDT/WBOT from the pool; 9.7254 from the BOT Chain DEX feed; 9.73 on Coinstore |
| Canary inventory router | `0x07032d47A1b9f8460cBeE9dC17c1d3E438693929` (expected WBOT/factory; factory resolves the pool above) |

Two shallower WBOT/USDT tiers exist on the same factory: fee 500 at
`0x050a7C2EC050A1D1402053A40a2Eb0F6275ed70a` and fee 10000 at
`0x5CF483E886A83dE87BD31ACb24d3f346454e49EB`. Both hold the same token pair, so
a pair check alone accepts either. `BOT_V3_FACTORY` is what separates them: the
oracle constructor asks the factory to confirm the address it was handed is the
pool that factory deployed for the pair and fee tier, and reverts with
`PoolNotCanonical` otherwise.

Do not continue if the chain, token orientation, observation call, or current
liquidity no longer matches the intended market. Recalibrate
`MIN_V3_LIQUIDITY`; documentation values are a snapshot, not an invariant.

Run all local tests plus the opt-in live-pool smoke test:

```bash
cd contracts
forge fmt --check
forge lint
forge test --force
MAINNET_RPC_URL="$RPC_URL" forge test --force \
  --match-path test/BotV3TwapOracle.mainnet.t.sol -vv
cd ..
```

## 2. Simulate, then broadcast

`Deploy.s.sol` requires explicit raw-unit caps. It deploys the oracle, deploys
the auction, installs both token cap sets, optionally allowlists the founding
trader and quote-provider wallets, and starts a two-step ownership handoff. It
does **not** call `unpause()`.

```bash
export DEPLOYER_PRIVATE_KEY=0x...

cd contracts
forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$RPC_URL" \
  --chain-id "$CHAIN_ID"

# Review every simulated address, constructor argument, cap, and owner action.
forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$RPC_URL" \
  --chain-id "$CHAIN_ID" \
  --broadcast
cd ..
```

Record the oracle address, auction address, deployment transaction, and block
from the broadcast output. Put only public values in `.env.mainnet`:

```bash
REFERENCE_ORACLE=0x...
NYX_BATCH_AUCTION=0x...
START_BLOCK=123456
```

## 3. Verify the deployed state before any opening transaction

```bash
cast call "$NYX_BATCH_AUCTION" "paused()(bool)" --rpc-url "$RPC_URL"
cast call "$NYX_BATCH_AUCTION" "allowlistEnabled()(bool)" --rpc-url "$RPC_URL"
cast call "$NYX_BATCH_AUCTION" "token0()(address)" --rpc-url "$RPC_URL"
cast call "$NYX_BATCH_AUCTION" "token1()(address)" --rpc-url "$RPC_URL"
cast call "$NYX_BATCH_AUCTION" "referenceOracle()(address)" --rpc-url "$RPC_URL"
cast call "$NYX_BATCH_AUCTION" "agent()(address)" --rpc-url "$RPC_URL"
cast call "$NYX_BATCH_AUCTION" "owner()(address)" --rpc-url "$RPC_URL"
cast call "$NYX_BATCH_AUCTION" "pendingOwner()(address)" --rpc-url "$RPC_URL"
cast call "$NYX_BATCH_AUCTION" "getReferencePriceX18()(uint256)" --rpc-url "$RPC_URL"
cast call "$NYX_BATCH_AUCTION" \
  "riskLimits(address)(uint256,uint256,uint256)" "$WBOT" --rpc-url "$RPC_URL"
cast call "$NYX_BATCH_AUCTION" \
  "riskLimits(address)(uint256,uint256,uint256)" "$BOUSDT" --rpc-url "$RPC_URL"
cast call "$NYX_BATCH_AUCTION" \
  "allowedTraders(address)(bool)" "$INITIAL_ALLOWED_TRADER" --rpc-url "$RPC_URL"
cast call "$NYX_BATCH_AUCTION" \
  "allowedTraders(address)(bool)" "$INITIAL_QUOTE_PROVIDER" --rpc-url "$RPC_URL"
```

The first two results must be `true`. Verify the runtime bytecode and pin its
hash for agent startup:

```bash
AUCTION_RUNTIME_CODE_HASH=$(cast keccak "$(cast code "$NYX_BATCH_AUCTION" --rpc-url "$RPC_URL")")
echo "$AUCTION_RUNTIME_CODE_HASH"
```

If `OWNER_ADDRESS` differs from the deployer, accept from the intended owner
only after the checks above:

```bash
export OWNER_PRIVATE_KEY=0x...
cast send "$NYX_BATCH_AUCTION" "acceptOwnership()" \
  --rpc-url "$RPC_URL" --private-key "$OWNER_PRIVATE_KEY"
```

Re-read `owner()` and `pendingOwner()`; the latter must now be zero.

## 4. Start the agent fail-closed

The agent validates chain ID, deployment block, exact runtime code hash, token
pair, oracle, V3 pool, settlement authority, and signer before recovering
orders. A mismatch makes `/health` fail.

Start read-only first:

```bash
set -a
source .env.mainnet
set +a
export DRY_RUN=true

cd agent
pnpm install --frozen-lockfile
pnpm test
pnpm build
pnpm dry-run
```

Then export `AGENT_PRIVATE_KEY` in the process shell, set `DRY_RUN=false`, and
run the built service behind TLS. The browser-facing `POST /orders` cannot use
a shared secret without exposing it to every browser; keep that route public
but origin-checked and rate-limited at both the agent and reverse proxy. Use
the separate `QUOTE_PROVIDER_BEARER_TOKEN` only for server-to-server
`GET /quote-requests` access.

```bash
curl -sS https://agent.example.com/health
curl -sS https://agent.example.com/status
curl -sS https://agent.example.com/quote-requests \
  -H "authorization: Bearer $QUOTE_PROVIDER_BEARER_TOKEN"
```

`/health` must report deployment verification, the expected authority, and the
paused state before opening.

## 5. Open only the capped two-wallet canary

The founding trader and quote provider must be distinct wallets; the matcher
and contract reject one wallet appearing on opposite sides. Both must already
be allowlisted and separately funded for gas.

From the accepted owner wallet:

```bash
cast send "$NYX_BATCH_AUCTION" "unpause()" \
  --rpc-url "$RPC_URL" --private-key "$OWNER_PRIVATE_KEY"
```

Run one tiny round:

```bash
export DEPLOYER_PRIVATE_KEY=0x...       # WBOT-side canary wallet
export COUNTERPARTY_PRIVATE_KEY=0x...   # distinct USDT-side wallet
scripts/demo-round.sh --reason pair --wbot-size 10000000000000000
```

The driver refuses to run when paused, when either wallet is not allowlisted,
or when both keys resolve to one address. It commits a 15-minute expiry and
waits for a confirmed settlement.

Immediately verify the transaction, balances, `BatchSettled` reference price,
settlement hash, and both escrow totals. Then pause again for review:

```bash
cast send "$NYX_BATCH_AUCTION" "pause()" \
  --rpc-url "$RPC_URL" --private-key "$OWNER_PRIVATE_KEY"
cast call "$NYX_BATCH_AUCTION" "totalEscrowed(address)(uint256)" "$WBOT" --rpc-url "$RPC_URL"
cast call "$NYX_BATCH_AUCTION" "totalEscrowed(address)(uint256)" "$BOUSDT" --rpc-url "$RPC_URL"
```

Only change caps or allowlist mode while paused. Do not disable the allowlist
until independent review, monitoring, and repeated canary settlements justify
the larger exposure.

## 6. Publish the web build

Set the `VITE_*` values from `.env.mainnet.example`, including
`VITE_REQUIRE_LIVE=true`, the 15-minute order TTL, and real application links.

```bash
cd web
pnpm install --frozen-lockfile
pnpm test
pnpm build
```

Verify in the deployed browser that the auction address, oracle, chain 677,
paused/allowlist state, cap display, expiry, refund path, and settlement receipt
all come from the new deployment. Never publish a mainnet build that silently
falls back to simulated data.

## Emergency stop and exit

`pause()` blocks new submissions and settlements, but it does not block
`cancelOrder` or `claimPayout`. Orders can refund immediately when their round
is stale or their committed expiry arrives; the two-day delay is only the
fallback. During an incident: pause, preserve logs/state, publish the affected
block range, let users exit, rotate agent authority if needed, and do not raise
caps to compensate for failed liquidity.
