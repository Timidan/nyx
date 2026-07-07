#!/usr/bin/env bash
# Seed several settled rounds on the live Nyx contract.
#
# Runs from your LOCAL machine (needs Foundry `cast`). Submits order pairs with
# the agent's own funded key and posts the preimages to the live agent, which
# signs and settles each round. Reason variety: matched pair, depth, notional,
# favorable spread.
#
#   # 1. get the agent key from the droplet (testnet-only), once:
#   #    ssh <droplet> "sudo grep AGENT_PRIVATE_KEY /etc/nyx-agent.env"
#   export AGENT_PRIVATE_KEY=0x...            # the owner+agent+deployer key
#   bash scripts/seed-rounds.sh
#
set -euo pipefail

RPC="${RPC_URL:-https://rpc.bohr.life}"
NYX="${NYX_BATCH_AUCTION:-0x58126ae8ff411a3B1768b121763a0E999221b6da}"
KEY="${AGENT_PRIVATE_KEY:?export AGENT_PRIVATE_KEY (owner+agent key) first}"
# live agent through nginx injects the bearer token; no token needed here
API="${AGENT_API:-https://nyx.timidan.xyz/agent}"
WBOT=0xD5452816194a3784dBa983426cCe7c122F4abd30
BOUSDT=0xAfea2A5e0587615ceD6972e271E5bfe8622ebcA2
PAIR=0x4C7a5bE488491A76b2839AcCFc13d8Dd5276a5e0
ME=$(cast wallet address "$KEY")
say(){ echo "[$(date -u +%H:%M:%S)] $*"; }
send(){ cast send "$@" --rpc-url "$RPC" --private-key "$KEY" >/dev/null; }
ref(){ cast call "$NYX" "getReferencePriceX18()(uint256)" --rpc-url "$RPC" | awk '{print $1}'; }
batch(){ cast call "$NYX" "currentBatchId()(uint64)" --rpc-url "$RPC" | awk '{print $1}'; }

say "seeding as $ME on $NYX (agent: $API)"

# one-time inventory: wrap 0.2 BOT, swap 0.08 WBOT -> BOUSDT, approve the auction
say "prep: wrapping + swapping for BOUSDT inventory"
send "$WBOT" "deposit()" --value 200000000000000000
R=$(cast call "$PAIR" "getReserves()(uint112,uint112,uint32)" --rpc-url "$RPC")
R0=$(echo "$R"|sed -n 1p|awk '{print $1}'); R1=$(echo "$R"|sed -n 2p|awk '{print $1}')
IN=80000000000000000
OUT=$(python3 -c "print(int($IN*997*$R0/($R1*1000+$IN*997)*98//100))")
send "$WBOT" "transfer(address,uint256)" "$PAIR" "$IN"
send "$PAIR" "swap(uint256,uint256,address,bytes)" "$OUT" 0 "$ME" 0x
send "$WBOT" "approve(address,uint256)" "$NYX" 1000000000000000000
send "$BOUSDT" "approve(address,uint256)" "$NYX" 100000000
say "prep done (BOUSDT: $(cast call $BOUSDT 'balanceOf(address)(uint256)' $ME --rpc-url $RPC))"

submit(){
  local TOKEN=$1 AMT=$2 MINBUY=$3 BID SALT COMMIT
  BID=$(batch)
  SALT=$(cast keccak "seed-$RANDOM-$(date +%s%N)")
  COMMIT=$(cast call "$NYX" "hashOrder((address,uint64,address,uint256,uint256,bytes32))(bytes32)" \
    "($ME,$BID,$TOKEN,$AMT,$MINBUY,$SALT)" --rpc-url "$RPC")
  send "$NYX" "submitOrder(uint64,bytes32,address,uint256)" "$BID" "$COMMIT" "$TOKEN" "$AMT"
  curl -s -X POST "$API/orders" -H 'content-type: application/json' --data \
    "{\"trader\":\"$ME\",\"batchId\":\"$BID\",\"sellToken\":\"$TOKEN\",\"sellAmount\":\"$AMT\",\"minBuyAmount\":\"$MINBUY\",\"salt\":\"$SALT\"}" >/dev/null
}
pair(){
  local WAMT=$1 SLACK=${2:-4} REF BAMT MBW MBB
  REF=$(ref); BAMT=$(python3 -c "print(($REF*$WAMT)//10**18//10**12)")
  MBW=$(python3 -c "print(int($BAMT*(100-$SLACK)//100))"); MBB=$(python3 -c "print(int($WAMT*(100-$SLACK)//100))")
  submit "$WBOT" "$WAMT" "$MBW"; submit "$BOUSDT" "$BAMT" "$MBB"
}
settle_wait(){ local B=$1; for i in $(seq 1 20); do sleep 6; [ "$(batch)" != "$B" ] && { say "  settled -> batch $(batch)"; return; }; done; say "  (timeout — agent may settle shortly)"; }

B=$(batch); say "round A: matched pair (reason 1)";      pair 12000000000000000 4; settle_wait "$B"
B=$(batch); say "round B: depth / enough orders (reason 0)"; submit "$BOUSDT" 100 1000000000000000000; submit "$BOUSDT" 100 1000000000000000000; pair 8000000000000000 4; settle_wait "$B"
B=$(batch); say "round C: notional / enough value (reason 2)"; submit "$WBOT" 26000000000000000 1000000000000000000; pair 50000000000000000 4; settle_wait "$B"
B=$(batch); say "round D: favorable spread (reason 4)";   submit "$WBOT" 5000000000000000 1000000000000000000; pair 2000000000000000 7; settle_wait "$B"

say "done. settled rounds now: $(( $(batch) - 1 ))"
say "explorer: https://scan.bohr.life/address/$NYX"
