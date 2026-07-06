# Nyx Backend Deploy Handoff

All commands assume the repo root is the current directory and that private keys
are exported in the shell, not stored in files.

## 1. Deploy NyxBatchAuction

```bash
set -a
source .env
set +a
export DEPLOYER_PRIVATE_KEY=0x...
export AGENT_PRIVATE_KEY=0x...

cd contracts
forge test
forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$RPC_URL" \
  --chain-id "$CHAIN_ID" \
  --broadcast
```

Copy the deployed `NyxBatchAuction` address from the forge output:

```bash
cd ..
export NYX_BATCH_AUCTION=0x...
```

## 2. Post-Deploy Agent Config

```bash
cast send "$NYX_BATCH_AUCTION" \
  "setAgent(address)" "$AGENT_ADDRESS" \
  --rpc-url "$RPC_URL" \
  --private-key "$DEPLOYER_PRIVATE_KEY"
```

Confirm:

```bash
cast call "$NYX_BATCH_AUCTION" "agent()(address)" --rpc-url "$RPC_URL"
cast call "$NYX_BATCH_AUCTION" "getReferencePriceX18()(uint256)" --rpc-url "$RPC_URL"
```

## 3. Start The Agent

Terminal A:

```bash
set -a
source .env
set +a
export NYX_BATCH_AUCTION=0x...
export AGENT_PRIVATE_KEY=0x...

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
