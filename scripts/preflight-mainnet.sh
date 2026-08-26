#!/usr/bin/env bash
#
# Nyx mainnet preflight. Re-reads every chain fact the deployment depends on and
# fails on the first mismatch, so the canary is never opened against a stale
# snapshot.
#
#   Before deploying:  scripts/preflight-mainnet.sh .env.mainnet
#   After deploying:   scripts/preflight-mainnet.sh .env.mainnet   (NYX_BATCH_AUCTION set)
#
# Reads only. It never broadcasts a transaction and never touches a private key.

set -uo pipefail

ENV_FILE="${1:-.env.mainnet}"
FAILURES=0
CHECKS=0

c_red=$'\033[31m'; c_grn=$'\033[32m'; c_dim=$'\033[2m'; c_off=$'\033[0m'
[ -t 1 ] || { c_red=""; c_grn=""; c_dim=""; c_off=""; }

pass() { CHECKS=$((CHECKS + 1)); printf '%s  ok  %s%s\n' "$c_grn" "$c_off" "$1"; }
fail() {
  CHECKS=$((CHECKS + 1)); FAILURES=$((FAILURES + 1))
  printf '%sFAIL  %s%s\n' "$c_red" "$c_off" "$1"
  [ $# -gt 1 ] && printf '      %sexpected %s%s\n' "$c_dim" "$2" "$c_off"
  [ $# -gt 2 ] && printf '      %sactual   %s%s\n' "$c_dim" "$3" "$c_off"
  return 0
}
note() { printf '      %s%s%s\n' "$c_dim" "$1" "$c_off"; }
section() { printf '\n%s\n' "$1"; }

expect() { # label expected actual
  if [ "$2" = "$3" ]; then pass "$1"; else fail "$1" "$2" "$3"; fi
}

lower() { printf '%s' "$1" | tr 'A-Z' 'a-z'; }

require_env() {
  local missing=0 name
  for name in "$@"; do
    if [ -z "${!name:-}" ]; then
      printf '%smissing %s in %s%s\n' "$c_red" "$name" "$ENV_FILE" "$c_off"
      missing=1
    fi
  done
  [ "$missing" -eq 0 ] || exit 2
}

command -v cast >/dev/null 2>&1 || { echo "cast not found; install Foundry" >&2; exit 2; }
[ -f "$ENV_FILE" ] || { echo "no env file at $ENV_FILE" >&2; exit 2; }

# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a
require_env RPC_URL CHAIN_ID WBOT BOUSDT BOT_V3_POOL BOT_V3_FACTORY \
  TWAP_WINDOW_SECONDS MIN_V3_LIQUIDITY MAX_SPOT_TWAP_DEVIATION_BPS

R=(--rpc-url "$RPC_URL")
# Filled in once the head block is known. Every contract read is pinned to that
# block so liquidity, spot, TWAP and identity describe one coherent snapshot
# rather than four different ones.
PIN=()
call() { cast call "$@" "${R[@]}" "${PIN[@]}" 2>/dev/null; }
# cast annotates large integers as `123 [1.23e2]`, which is unparseable. --json
# returns the plain values, so every numeric read goes through jfield.
jcall() { cast call "$@" "${R[@]}" "${PIN[@]}" --json 2>/dev/null; }
jfield() { # index < json
  python3 -c '
import json, sys
value = json.load(sys.stdin)[int(sys.argv[1])]
print(str(value).lower() if isinstance(value, bool) else value)' "$1" 2>/dev/null
}

printf 'Nyx mainnet preflight  %s\n' "$(date -u '+%Y-%m-%d %H:%M:%SZ')"
printf '%senv %s  rpc %s%s\n' "$c_dim" "$ENV_FILE" "$RPC_URL" "$c_off"

section "chain"
CHAIN_ACTUAL="$(cast chain-id "${R[@]}" 2>/dev/null || echo unreachable)"
expect "chain id is $CHAIN_ID" "$CHAIN_ID" "$CHAIN_ACTUAL"
[ "$CHAIN_ACTUAL" = "$CHAIN_ID" ] || { printf '\nstopping: wrong chain\n'; exit 1; }
BLOCK="$(cast block-number "${R[@]}")"
PIN=(--block "$BLOCK")
note "head block $BLOCK, and every contract read below is pinned to it"

section "tokens"
expect "WBOT decimals are 18" "18" "$(call "$WBOT" 'decimals()(uint8)')"
expect "USDT decimals are 6" "6" "$(call "$BOUSDT" 'decimals()(uint8)')"

section "pool"
POOL_T0="$(call "$BOT_V3_POOL" 'token0()(address)')"
POOL_T1="$(call "$BOT_V3_POOL" 'token1()(address)')"
POOL_FEE="$(call "$BOT_V3_POOL" 'fee()(uint24)')"
PAIR_OK=0
if [ "$(lower "$POOL_T0")" = "$(lower "$BOUSDT")" ] && [ "$(lower "$POOL_T1")" = "$(lower "$WBOT")" ]; then PAIR_OK=1; fi
if [ "$(lower "$POOL_T0")" = "$(lower "$WBOT")" ] && [ "$(lower "$POOL_T1")" = "$(lower "$BOUSDT")" ]; then PAIR_OK=1; fi
if [ "$PAIR_OK" -eq 1 ]; then
  pass "pool holds the configured WBOT/USDT pair"
else
  fail "pool holds the configured WBOT/USDT pair" "$WBOT + $BOUSDT" "$POOL_T0 + $POOL_T1"
fi
note "fee tier $POOL_FEE"

# The pair check above is satisfied by any pool holding these two tokens,
# including a shallow sibling tier or an attacker-seeded clone. Only the factory
# round-trip identifies the canonical pool.
CANONICAL="$(call "$BOT_V3_FACTORY" 'getPool(address,address,uint24)(address)' "$POOL_T0" "$POOL_T1" "$POOL_FEE")"
expect "factory confirms this is the canonical pool" \
  "$(lower "$BOT_V3_POOL")" "$(lower "${CANONICAL:-none}")"

# Every number below reaches Python through argv, never by being pasted into
# Python source. The price feeds are remote HTTP responses; interpolating one
# into a script would hand a compromised feed the deploy shell, private keys
# and all.
pyc() { # script, then values as argv
  local script="$1"; shift
  python3 -c "$script" "$@" 2>/dev/null
}

# Refuses anything that is not a finite, positive number.
NUMERIC='
import math, sys
try:
    value = float(sys.argv[1])
except (IndexError, ValueError):
    sys.exit(1)
sys.exit(0 if math.isfinite(value) and value > 0 else 1)
'
numeric() { pyc "$NUMERIC" "$1"; }

section "oracle inputs"
LIQ="$(jcall "$BOT_V3_POOL" 'liquidity()(uint128)' | jfield 0)"
LIQ_NOTE="$(pyc '
import sys
liquidity, floor = int(sys.argv[1]), int(sys.argv[2])
if liquidity < floor:
    sys.exit(1)
print(f"liquidity {liquidity:.3e}  floor {floor:.3e}  headroom {liquidity / floor:.2f}x")
' "${LIQ:-0}" "$MIN_V3_LIQUIDITY")"
if [ -n "$LIQ_NOTE" ]; then
  pass "active liquidity clears the configured floor"
  note "$LIQ_NOTE"
else
  fail "active liquidity clears the configured floor" ">= $MIN_V3_LIQUIDITY" "${LIQ:-unreadable}"
fi

SLOT0="$(jcall "$BOT_V3_POOL" 'slot0()(uint160,int24,uint16,uint16,uint16,uint8,bool)')"
SPOT_TICK="$(printf '%s' "$SLOT0" | jfield 1)"
CARDINALITY="$(printf '%s' "$SLOT0" | jfield 3)"
expect "pool is unlocked" "true" "$(printf '%s' "$SLOT0" | jfield 6)"

OBS="$(jcall "$BOT_V3_POOL" "observe(uint32[])(int56[],uint160[])" "[$TWAP_WINDOW_SECONDS,0]")"
MEAN_TICK="$(printf '%s' "$OBS" | pyc '
import json, sys
past, now = (int(v) for v in json.load(sys.stdin)[0][:2])
print((now - past) // int(sys.argv[1]))
' "$TWAP_WINDOW_SECONDS")"
if [ -n "$MEAN_TICK" ]; then
  pass "pool serves a ${TWAP_WINDOW_SECONDS}s observation window"
  note "observation cardinality $CARDINALITY"
  DEV="$(pyc '
import sys
twap, spot = 1.0001 ** int(sys.argv[1]), 1.0001 ** int(sys.argv[2])
print(f"{abs(twap - spot) / twap * 10000:.1f}")
' "$MEAN_TICK" "$SPOT_TICK")"
  if [ -n "$DEV" ] && pyc '
import sys
sys.exit(0 if float(sys.argv[1]) <= float(sys.argv[2]) else 1)
' "$DEV" "$MAX_SPOT_TWAP_DEVIATION_BPS"; then
    pass "spot sits within ${MAX_SPOT_TWAP_DEVIATION_BPS}bps of the TWAP"
  else
    fail "spot sits within ${MAX_SPOT_TWAP_DEVIATION_BPS}bps of the TWAP" \
      "<= ${MAX_SPOT_TWAP_DEVIATION_BPS}bps" "${DEV:-unreadable}bps"
  fi
  note "$(pyc '
import sys
mean_tick, spot_tick, deviation = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3]
wbot_per_usdt = (1.0001 ** mean_tick) * (10 ** 6) / (10 ** 18)
print(f"TWAP tick {mean_tick}  spot tick {spot_tick}  deviation {deviation}bps  ~{1 / wbot_per_usdt:.4f} USDT/WBOT")
' "$MEAN_TICK" "$SPOT_TICK" "${DEV:-0}")"
else
  fail "pool serves a ${TWAP_WINDOW_SECONDS}s observation window" "observe() to return" "revert"
fi

section "independent price cross-check"
# BOT Chain publishes its own price feeds. A large gap means either the pool or
# the feed is wrong; both being wrong the same way is the case worth catching.
DEX_PRICE="$(curl -fsS -m 20 "https://dex-wallet.botchain.ai/api/graph/price?token=$WBOT" 2>/dev/null \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['price'])" 2>/dev/null || true)"
CEX_PRICE="$(curl -fsS -m 20 "https://api.coinstore.com/api/v1/ticker/price;symbol=BOTUSDT" 2>/dev/null \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['data'][0]['price'])" 2>/dev/null || true)"

compare_feed() { # label price
  local label="$1" price="$2" gap
  if [ -z "$price" ] || ! numeric "$price"; then
    if [ -z "$price" ] && [ "${PREFLIGHT_SKIP_PRICE_CROSSCHECK:-0}" = "1" ]; then
      CHECKS=$((CHECKS + 1))
      printf '%s skip %s%s\n' "$c_dim" "$c_off" \
        "pool TWAP agrees with $label (waived by PREFLIGHT_SKIP_PRICE_CROSSCHECK)"
      return 0
    fi
    fail "pool TWAP agrees with $label" "a finite positive price" "${price:-no response}"
    return 0
  fi
  gap="$(pyc '
import sys
mean_tick, feed = int(sys.argv[1]), float(sys.argv[2])
own = 1 / ((1.0001 ** mean_tick) * (10 ** 6) / (10 ** 18))
print(f"{abs(own - feed) / own * 10000:.1f}")
' "$MEAN_TICK" "$price")"
  if [ -z "$gap" ]; then
    fail "pool TWAP agrees with $label" "a comparable price" "comparison failed"
    return 0
  fi
  if pyc 'import sys; sys.exit(0 if float(sys.argv[1]) <= 200 else 1)' "$gap"; then
    pass "pool TWAP agrees with $label"
  else
    fail "pool TWAP agrees with $label" "<= 200bps" "${gap}bps"
  fi
  note "$label $price, gap ${gap}bps"
}

if [ -n "${MEAN_TICK:-}" ]; then
  # An on-chain pool that agrees with itself proves nothing. Two independent
  # feeds are what catch a pool that has been walked away from the market.
  compare_feed "the BOT Chain DEX feed" "$DEX_PRICE"
  compare_feed "Coinstore" "$CEX_PRICE"
else
  fail "pool TWAP agrees with the published feeds" "a readable TWAP" "none"
fi

if [ -n "${NYX_BATCH_AUCTION:-}" ]; then
  section "deployment"
  # Post-deployment every one of these is required. Skipping a check because
  # its variable is unset turns a missing answer into a green run, which is the
  # one failure mode a release gate must not have.
  require_env REFERENCE_ORACLE AGENT_ADDRESS OWNER_ADDRESS AUCTION_RUNTIME_CODE_HASH \
    INITIAL_ALLOWED_TRADER INITIAL_QUOTE_PROVIDER \
    WBOT_PER_ORDER_CAP WBOT_PER_BATCH_CAP WBOT_GLOBAL_CAP \
    BOUSDT_PER_ORDER_CAP BOUSDT_PER_BATCH_CAP BOUSDT_GLOBAL_CAP

  expect "auction starts paused" "true" "$(call "$NYX_BATCH_AUCTION" 'paused()(bool)')"
  expect "allowlist is enforced" "true" "$(call "$NYX_BATCH_AUCTION" 'allowlistEnabled()(bool)')"
  expect "auction points at the deployed oracle" \
    "$(lower "$REFERENCE_ORACLE")" "$(lower "$(call "$NYX_BATCH_AUCTION" 'referenceOracle()(address)')")"
  expect "auction pair is WBOT/USDT" \
    "$(lower "$WBOT") $(lower "$BOUSDT")" \
    "$(lower "$(call "$NYX_BATCH_AUCTION" 'token0()(address)')") $(lower "$(call "$NYX_BATCH_AUCTION" 'token1()(address)')")"
  expect "agent is the configured signer" \
    "$(lower "$AGENT_ADDRESS")" "$(lower "$(call "$NYX_BATCH_AUCTION" 'agent()(address)')")"
  expect "owner is the intended account" \
    "$(lower "$OWNER_ADDRESS")" "$(lower "$(call "$NYX_BATCH_AUCTION" 'owner()(address)')")"
  expect "no agent handoff is pending" \
    "0x0000000000000000000000000000000000000000" \
    "$(lower "$(call "$NYX_BATCH_AUCTION" 'pendingAgent()(address)')")"
  expect "no ownership handoff is pending" \
    "0x0000000000000000000000000000000000000000" \
    "$(lower "$(call "$NYX_BATCH_AUCTION" 'pendingOwner()(address)')")"

  section "canary wallets"
  # An auction whose two wallets are the same account cannot produce genuine
  # counterflow, and the contract rejects cross-side self-trade anyway.
  if [ "$(lower "$INITIAL_ALLOWED_TRADER")" != "$(lower "$INITIAL_QUOTE_PROVIDER")" ]; then
    pass "the two canary wallets are distinct accounts"
  else
    fail "the two canary wallets are distinct accounts" "two addresses" "one address twice"
  fi
  expect "the trader wallet is allowlisted" "true" \
    "$(call "$NYX_BATCH_AUCTION" 'allowedTraders(address)(bool)' "$INITIAL_ALLOWED_TRADER")"
  expect "the quote-provider wallet is allowlisted" "true" \
    "$(call "$NYX_BATCH_AUCTION" 'allowedTraders(address)(bool)' "$INITIAL_QUOTE_PROVIDER")"

  section "oracle binding"
  expect "oracle is bound to the canonical pool" \
    "$(lower "$BOT_V3_POOL")" "$(lower "$(call "$REFERENCE_ORACLE" 'pool()(address)')")"
  expect "oracle is bound to the published factory" \
    "$(lower "$BOT_V3_FACTORY")" "$(lower "$(call "$REFERENCE_ORACLE" 'factory()(address)')")"
  # The single most useful check on the page: the deployed auction reading the
  # deployed oracle through every floor, band and window it enforces.
  DEPLOYED_PRICE="$(jcall "$NYX_BATCH_AUCTION" 'getReferencePriceX18()(uint256)' | jfield 0)"
  if [ -n "$DEPLOYED_PRICE" ] && [ "$DEPLOYED_PRICE" != "0" ]; then
    pass "the deployed auction reads a live reference price"
    note "$(pyc 'import sys; print(f"getReferencePriceX18 = {int(sys.argv[1]) / 10 ** 18:.6f} USDT per WBOT")' "$DEPLOYED_PRICE")"
  else
    fail "the deployed auction reads a live reference price" "a non-zero price" "revert or zero"
  fi

  section "risk limits"
  for pair in "WBOT $WBOT" "BOUSDT $BOUSDT"; do
    set -- $pair
    label="$1"; token="$2"
    caps="$(jcall "$NYX_BATCH_AUCTION" 'riskLimits(address)(uint256,uint256,uint256)' "$token" \
      | python3 -c "import json,sys; print(' '.join(str(int(v)) for v in json.load(sys.stdin)))" 2>/dev/null)"
    per_order="${label}_PER_ORDER_CAP"; per_batch="${label}_PER_BATCH_CAP"; global_cap="${label}_GLOBAL_CAP"
    expect "$label caps match the template" \
      "${!per_order} ${!per_batch} ${!global_cap}" "${caps:-unreadable}"
    escrowed="$(jcall "$NYX_BATCH_AUCTION" 'totalEscrowed(address)(uint256)' "$token" | jfield 0)"
    expect "$label escrow starts at zero" "0" "${escrowed:-unreadable}"
  done

  section "bytecode"
  expect "runtime code hash is pinned" \
    "$(lower "$AUCTION_RUNTIME_CODE_HASH")" \
    "$(lower "$(cast codehash "$NYX_BATCH_AUCTION" "${R[@]}" "${PIN[@]}" 2>/dev/null)")"
else
  section "deployment"
  note "NYX_BATCH_AUCTION unset; pre-deploy mode, contract checks skipped"
fi

printf '\n'
if [ "$FAILURES" -eq 0 ]; then
  printf '%s%d checks passed at block %s.%s\n' "$c_grn" "$CHECKS" "$BLOCK" "$c_off"
  printf 'Snapshot is good now, not later. Re-run immediately before unpause.\n'
  exit 0
fi
printf '%s%d of %d checks failed at block %s. Do not deploy or unpause.%s\n' \
  "$c_red" "$FAILURES" "$CHECKS" "$BLOCK" "$c_off"
exit 1
