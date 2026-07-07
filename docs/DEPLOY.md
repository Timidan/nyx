# Nyx Deploy Runbook

All commands assume the repo root is the current directory and that private keys
are exported in the shell, not stored in files.

> The current live instance
> [`0x58126a…b6da`](https://scan.bohr.life/address/0x58126ae8ff411a3B1768b121763a0E999221b6da)
> was deployed from current source and includes the immutable clearing-price
> deviation guard and two-step agent rotation. Earlier instances are historical;
> because `maxReferenceDeviationBps` and `cancelDelaySeconds` are
> constructor-immutable, upgrading means redeploying with this runbook, not
> retrofitting.

## 1. Deploy NyxBatchAuction

```bash
set -a
source .env
set +a
export DEPLOYER_PRIVATE_KEY=0x...
export MAX_CLEARING_DEVIATION_BPS=1000   # optional; constructor default is 1000

cd contracts
forge test
forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$RPC_URL" \
  --chain-id "$CHAIN_ID" \
  --broadcast
```

`Deploy.s.sol` reads `WBOT`, `BOUSDT`, and `BOT_DEX_PAIR` from `.env` (as
`token0`, `token1`, and `referencePair`), reads `AGENT_ADDRESS` and
`MAX_CLEARING_DEVIATION_BPS`, hardcodes a **2-day** cancel delay, and sets
`AGENT_ADDRESS` as the contract's initial `agent`. `maxReferenceDeviationBps`
and `cancelDelaySeconds` are
immutable — choose them at deploy time.

Copy the deployed `NyxBatchAuction` address from the forge output:

```bash
cd ..
export NYX_BATCH_AUCTION=0x...
```

## 2. Rotate Settlement Authority To The Agent Wallet (two-step)

The constructor made the **deployer** the initial `agent`. The documented setup
runs the agent process from a separate wallet (`AGENT_ADDRESS` /
`AGENT_PRIVATE_KEY`), so a fresh deployment must hand settlement authority over
with the two-step rotation **before the agent process can settle**. The
**owner (== deployer)** signs `setAgent`; the **incoming agent wallet** signs
`acceptAgent`. Authority only moves once the pending agent accepts.

```bash
# derive the agent address from its key if it is not already exported
export AGENT_ADDRESS="${AGENT_ADDRESS:-$(cast wallet address --private-key "$AGENT_PRIVATE_KEY")}"

# step 1 — owner (== deployer) nominates the agent wallet
cast send "$NYX_BATCH_AUCTION" \
  "setAgent(address)" "$AGENT_ADDRESS" \
  --rpc-url "$RPC_URL" \
  --private-key "$DEPLOYER_PRIVATE_KEY"

# step 2 — the agent wallet accepts; settlement authority moves only now
cast send "$NYX_BATCH_AUCTION" \
  "acceptAgent()" \
  --rpc-url "$RPC_URL" \
  --private-key "$AGENT_PRIVATE_KEY"
```

If you intend the deployer key to also be the agent, skip this step — the
deployer is already the agent. The same two commands perform any later rotation
(owner nominates, new agent accepts).

Confirm — after rotation `agent()` is the agent wallet and `pendingAgent()` is
the zero address:

```bash
cast call "$NYX_BATCH_AUCTION" "agent()(address)" --rpc-url "$RPC_URL"
cast call "$NYX_BATCH_AUCTION" "pendingAgent()(address)" --rpc-url "$RPC_URL"
cast call "$NYX_BATCH_AUCTION" "getReferencePriceX18()(uint256)" --rpc-url "$RPC_URL"
cast call "$NYX_BATCH_AUCTION" "maxReferenceDeviationBps()(uint256)" --rpc-url "$RPC_URL"
```

## 3. Start The Agent

Terminal A:

```bash
set -a
source .env
set +a
export NYX_BATCH_AUCTION=0x...
export AGENT_PRIVATE_KEY=0x...
export AGENT_HOST=127.0.0.1
export CORS_ORIGIN=http://localhost:5190
# For public deployments, put the agent behind TLS and enable:
# export AGENT_REQUIRE_API_BEARER_TOKEN=true
# export AGENT_API_BEARER_TOKEN="$(openssl rand -hex 32)"

cd agent
npm_config_cache=/tmp/npm-cache npx --yes pnpm@9.15.9 install --store-dir /tmp/pnpm-store
npm_config_cache=/tmp/npm-cache npx --yes pnpm@9.15.9 dev
```

Health checks:

```bash
curl -sS http://localhost:8787/health
curl -sS http://localhost:8787/status
```

Read-only dry run, no key required:

```bash
cd agent
npm_config_cache=/tmp/npm-cache npx --yes pnpm@9.15.9 dry-run
```

## 4. De-Risk Milestone: Two Orders And One Agent Settlement

Use tiny amounts. The real DEX liquidity is small.

Terminal B:

```bash
set -a
source .env
set +a
export NYX_BATCH_AUCTION=0x...
export DEPLOYER_PRIVATE_KEY=0x...

export SELL_WBOT=10000000000000000
export SELL_BOUSDT=100000
export CLEARING_PRICE_X18=10000000000000000000
export BATCH_ID=$(cast call "$NYX_BATCH_AUCTION" "currentBatchId()(uint64)" --rpc-url "$RPC_URL")
```

Prepare small real token balances:

```bash
cast send "$WBOT" "deposit()" \
  --value 30000000000000000 \
  --rpc-url "$RPC_URL" \
  --private-key "$DEPLOYER_PRIVATE_KEY"

cast send "$WBOT" "approve(address,uint256)" "$SWAP_ROUTER" 20000000000000000 \
  --rpc-url "$RPC_URL" \
  --private-key "$DEPLOYER_PRIVATE_KEY"

export DEADLINE=$(($(date +%s) + 900))
cast send "$SWAP_ROUTER" \
  "exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))" \
  "($WBOT,$BOUSDT,3000,$DEPLOYER_ADDRESS,$DEADLINE,20000000000000000,0,0)" \
  --rpc-url "$RPC_URL" \
  --private-key "$DEPLOYER_PRIVATE_KEY"
```

Approve the auction:

```bash
cast send "$WBOT" "approve(address,uint256)" "$NYX_BATCH_AUCTION" "$SELL_WBOT" \
  --rpc-url "$RPC_URL" \
  --private-key "$DEPLOYER_PRIVATE_KEY"

cast send "$BOUSDT" "approve(address,uint256)" "$NYX_BATCH_AUCTION" "$SELL_BOUSDT" \
  --rpc-url "$RPC_URL" \
  --private-key "$DEPLOYER_PRIVATE_KEY"
```

Compute commitments through the deployed contract:

```bash
export SALT_WBOT=$(cast keccak "nyx-demo-wbot-$(date +%s)")
export SALT_BOUSDT=$(cast keccak "nyx-demo-bousdt-$(date +%s)")

export COMMIT_WBOT=$(cast call "$NYX_BATCH_AUCTION" \
  "hashOrder((address,uint64,address,uint256,uint256,bytes32))(bytes32)" \
  "($DEPLOYER_ADDRESS,$BATCH_ID,$WBOT,$SELL_WBOT,$SELL_BOUSDT,$SALT_WBOT)" \
  --rpc-url "$RPC_URL")

export COMMIT_BOUSDT=$(cast call "$NYX_BATCH_AUCTION" \
  "hashOrder((address,uint64,address,uint256,uint256,bytes32))(bytes32)" \
  "($DEPLOYER_ADDRESS,$BATCH_ID,$BOUSDT,$SELL_BOUSDT,$SELL_WBOT,$SALT_BOUSDT)" \
  --rpc-url "$RPC_URL")
```

Submit both commitments on-chain:

```bash
cast send "$NYX_BATCH_AUCTION" \
  "submitOrder(uint64,bytes32,address,uint256)" \
  "$BATCH_ID" "$COMMIT_WBOT" "$WBOT" "$SELL_WBOT" \
  --rpc-url "$RPC_URL" \
  --private-key "$DEPLOYER_PRIVATE_KEY"

cast send "$NYX_BATCH_AUCTION" \
  "submitOrder(uint64,bytes32,address,uint256)" \
  "$BATCH_ID" "$COMMIT_BOUSDT" "$BOUSDT" "$SELL_BOUSDT" \
  --rpc-url "$RPC_URL" \
  --private-key "$DEPLOYER_PRIVATE_KEY"
```

Send the preimages to the local agent API:

```bash
curl -sS -X POST http://localhost:8787/orders \
  -H 'content-type: application/json' \
  --data '{"trader":"'"$DEPLOYER_ADDRESS"'","batchId":"'"$BATCH_ID"'","sellToken":"'"$WBOT"'","sellAmount":"'"$SELL_WBOT"'","minBuyAmount":"'"$SELL_BOUSDT"'","salt":"'"$SALT_WBOT"'"}'

curl -sS -X POST http://localhost:8787/orders \
  -H 'content-type: application/json' \
  --data '{"trader":"'"$DEPLOYER_ADDRESS"'","batchId":"'"$BATCH_ID"'","sellToken":"'"$BOUSDT"'","sellAmount":"'"$SELL_BOUSDT"'","minBuyAmount":"'"$SELL_WBOT"'","salt":"'"$SALT_BOUSDT"'"}'
```

The agent should simulate, sign with `AGENT_PRIVATE_KEY`, and send
`settleBatch`. Watch status:

```bash
curl -sS http://localhost:8787/status
cast call "$NYX_BATCH_AUCTION" "currentBatchId()(uint64)" --rpc-url "$RPC_URL"
```

## 5. One-Command Demo Round

With the agent already running on `:8787`, run one seeded batch from the repo
root:

```bash
export DEPLOYER_PRIVATE_KEY=0x...
scripts/demo-round.sh --wbot-size 10000000000000000 --price-slack-bps 0 --reason pair
```

Usage:

```bash
scripts/demo-round.sh [--wbot-size WEI] [--price-slack-bps BPS] [--reason pair|depth|notional|spread] [--agent-url URL]
```

The script sources `.env`, reads `NYX_BATCH_AUCTION`, wraps tiny WBOT, swaps a
small WBOT amount through the V3 router for BOUSDT, approves the auction,
submits exact-conserving commitments, POSTs the reveals to the local agent, and
polls until it can print the settlement tx.

Reason targets:

- `pair` submits one exact complementary pair.
- `depth` submits enough exact pairs to reach `DEPTH_MIN`.
- `notional` sizes the pair above `NOTIONAL_MAX_X18` when `--wbot-size` is not
  provided.
- `spread` lowers the clearing price within `MAX_CLEARING_DEVIATION_BPS` and
  relaxes min-buy values so `decision.dexSpreadOk` can become true. The agent's
  reason priority still applies, so `depth` or `imbalance` may win first if the
  live config says they should.
