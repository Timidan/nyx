#!/usr/bin/env bash
# Run one live Nyx demo round against the already-running local agent.
#
# Usage:
#   scripts/demo-round.sh [--wbot-size WEI] [--price-slack-bps BPS] [--reason pair|depth|notional|spread] [--agent-url URL]
#
# Positional shorthand is also supported:
#   scripts/demo-round.sh [WBOT_SIZE_WEI] [PRICE_SLACK_BPS] [pair|depth|notional|spread]
#
# Defaults: --wbot-size 10000000000000000, --price-slack-bps 0,
# --reason pair, --agent-url http://localhost:${AGENT_PORT:-8787}.
# Requires DEPLOYER_PRIVATE_KEY for the WBOT side and a distinct
# COUNTERPARTY_PRIVATE_KEY for the BOUSDT side. Nyx rejects cross-side
# self-trading even when the amounts conserve exactly.
# "price slack" is applied to minBuy values in basis points. The spread mode
# also nudges the clearing price below the live reference price, within
# MAX_CLEARING_DEVIATION_BPS, so dexSpreadOk can become true.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

WBOT_SIZE_ARG=""
PRICE_SLACK_ARG=""
REASON="pair"
AGENT_URL="http://localhost:${AGENT_PORT:-8787}"

usage() {
  sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --wbot-size)
      WBOT_SIZE_ARG="${2:?--wbot-size requires a value}"
      shift 2
      ;;
    --price-slack-bps)
      PRICE_SLACK_ARG="${2:?--price-slack-bps requires a value}"
      shift 2
      ;;
    --reason)
      REASON="${2:?--reason requires a value}"
      shift 2
      ;;
    --agent-url)
      AGENT_URL="${2:?--agent-url requires a value}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    pair|depth|notional|spread)
      REASON="$1"
      shift
      ;;
    *)
      if [[ -z "$WBOT_SIZE_ARG" ]]; then
        WBOT_SIZE_ARG="$1"
      elif [[ -z "$PRICE_SLACK_ARG" ]]; then
        PRICE_SLACK_ARG="$1"
      else
        REASON="$1"
      fi
      shift
      ;;
  esac
done

case "$REASON" in
  pair|depth|notional|spread) ;;
  *)
    echo "unsupported --reason '$REASON' (expected pair, depth, notional, or spread)" >&2
    exit 2
    ;;
esac

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing required command: $1" >&2
    exit 1
  fi
}

require_env() {
  if [[ -z "${!1:-}" ]]; then
    echo "$1 is required; export it or add it to .env" >&2
    exit 1
  fi
}

require_cmd cast
require_cmd curl
require_cmd node

require_env RPC_URL
require_env NYX_BATCH_AUCTION
require_env DEPLOYER_PRIVATE_KEY
require_env COUNTERPARTY_PRIVATE_KEY
require_env WBOT
require_env BOUSDT
require_env SWAP_ROUTER

DEPLOYER_ADDRESS="${DEPLOYER_ADDRESS:-$(cast wallet address --private-key "$DEPLOYER_PRIVATE_KEY")}"
COUNTERPARTY_ADDRESS="${COUNTERPARTY_ADDRESS:-$(cast wallet address --private-key "$COUNTERPARTY_PRIVATE_KEY")}"
if [[ "${DEPLOYER_ADDRESS,,}" == "${COUNTERPARTY_ADDRESS,,}" ]]; then
  echo "COUNTERPARTY_PRIVATE_KEY must control a wallet distinct from DEPLOYER_PRIVATE_KEY" >&2
  exit 1
fi
CHAIN_ID="${CHAIN_ID:-968}"
DEPTH_MIN="${DEPTH_MIN:-4}"
NOTIONAL_MAX_X18="${NOTIONAL_MAX_X18:-1000000000000000000}"
DEX_SPREAD_BPS="${DEX_SPREAD_BPS:-500}"
MAX_CLEARING_DEVIATION_BPS="${MAX_CLEARING_DEVIATION_BPS:-1000}"
ORDER_TTL_SECONDS="${ORDER_TTL_SECONDS:-900}"
CANCEL_DELAY_SECONDS="$(cast call "$NYX_BATCH_AUCTION" "cancelDelaySeconds()(uint256)" --rpc-url "$RPC_URL" | awk '{print $1}')"
if (( ORDER_TTL_SECONDS > CANCEL_DELAY_SECONDS )); then
  ORDER_TTL_SECONDS="$CANCEL_DELAY_SECONDS"
fi
EXPIRES_AT="$(($(date +%s) + ORDER_TTL_SECONDS))"

# Newer `cast` annotates numeric returns as "123 [1.23e2]"; keep the first field.
REFERENCE_PRICE_X18="$(cast call "$NYX_BATCH_AUCTION" "getReferencePriceX18()(uint256)" --rpc-url "$RPC_URL" | awk '{print $1}')"
BATCH_ID="$(cast call "$NYX_BATCH_AUCTION" "currentBatchId()(uint64)" --rpc-url "$RPC_URL" | awk '{print $1}')"
PAUSED="$(cast call "$NYX_BATCH_AUCTION" "paused()(bool)" --rpc-url "$RPC_URL")"
if [[ "$PAUSED" != "false" ]]; then
  echo "Nyx is paused; complete canary verification before unpausing" >&2
  exit 1
fi
if [[ "$(cast call "$NYX_BATCH_AUCTION" "allowlistEnabled()(bool)" --rpc-url "$RPC_URL")" == "true" ]]; then
  for trader in "$DEPLOYER_ADDRESS" "$COUNTERPARTY_ADDRESS"; do
    if [[ "$(cast call "$NYX_BATCH_AUCTION" "allowedTraders(address)(bool)" "$trader" --rpc-url "$RPC_URL")" != "true" ]]; then
      echo "$trader is not allowlisted for the canary" >&2
      exit 1
    fi
  done
fi

CALCULATED_VALUES="$(
  REASON="$REASON" \
  WBOT_SIZE_ARG="$WBOT_SIZE_ARG" \
  PRICE_SLACK_ARG="$PRICE_SLACK_ARG" \
  REFERENCE_PRICE_X18="$REFERENCE_PRICE_X18" \
  DEPTH_MIN="$DEPTH_MIN" \
  NOTIONAL_MAX_X18="$NOTIONAL_MAX_X18" \
  DEX_SPREAD_BPS="$DEX_SPREAD_BPS" \
  MAX_CLEARING_DEVIATION_BPS="$MAX_CLEARING_DEVIATION_BPS" \
  node <<'NODE'
const X18 = 10n ** 18n;
const PRICE_DENOMINATOR = 10n ** 30n;
const env = process.env;

function readBigInt(name, fallback) {
  const value = env[name];
  if (value == null || value === "") return fallback;
  if (!/^[0-9]+$/.test(value)) throw new Error(`${name} must be a decimal integer`);
  return BigInt(value);
}

const reason = env.REASON;
const userWbot = env.WBOT_SIZE_ARG != null && env.WBOT_SIZE_ARG !== "";
const userSlack = env.PRICE_SLACK_ARG != null && env.PRICE_SLACK_ARG !== "";
let wbotSize = readBigInt("WBOT_SIZE_ARG", 10n ** 16n);
let priceSlackBps = readBigInt("PRICE_SLACK_ARG", 0n);
const referencePriceX18 = readBigInt("REFERENCE_PRICE_X18");
const depthMin = readBigInt("DEPTH_MIN", 4n);
const notionalMaxX18 = readBigInt("NOTIONAL_MAX_X18", X18);
const dexSpreadBps = readBigInt("DEX_SPREAD_BPS", 500n);
const maxDeviationBps = readBigInt("MAX_CLEARING_DEVIATION_BPS", 1000n);

if (priceSlackBps >= 10000n) throw new Error("PRICE_SLACK_BPS must be below 10000");
if (referencePriceX18 <= 0n) throw new Error("reference price must be positive");

let pairCount = 1n;
let targetPriceX18 = referencePriceX18;

if (reason === "depth") {
  pairCount = (depthMin + 1n) / 2n;
}

if (reason === "notional" && !userWbot) {
  const needed = ((notionalMaxX18 * X18) + referencePriceX18 - 1n) / referencePriceX18;
  const roundedNeeded = ((needed + 10n ** 12n - 1n) / (10n ** 12n)) * (10n ** 12n);
  wbotSize = roundedNeeded > wbotSize ? roundedNeeded : wbotSize;
}

if (reason === "spread") {
  const desiredDeviation = userSlack ? priceSlackBps : dexSpreadBps + 100n;
  const deviation = desiredDeviation > maxDeviationBps ? maxDeviationBps : desiredDeviation;
  targetPriceX18 = (referencePriceX18 * (10000n - deviation)) / 10000n;
  if (!userSlack) priceSlackBps = dexSpreadBps + 100n;
}

function absDiff(a, b) {
  return a >= b ? a - b : b - a;
}

function exactPairNearTarget() {
  const estimate = (wbotSize * targetPriceX18) / PRICE_DENOMINATOR;
  let best = null;
  for (let offset = 0n; offset <= 200000n; offset++) {
    for (const candidateBousdt of offset === 0n ? [estimate] : [estimate - offset, estimate + offset]) {
      if (candidateBousdt <= 0n) continue;
      const price = (candidateBousdt * PRICE_DENOMINATOR) / wbotSize;
      if (price <= 0n) continue;
      const token0Preview = (wbotSize * price) / PRICE_DENOMINATOR;
      const token1Preview = (candidateBousdt * PRICE_DENOMINATOR) / price;
      if (token0Preview !== candidateBousdt || token1Preview !== wbotSize) continue;
      const delta = absDiff(price, targetPriceX18);
      if (best == null || delta < best.delta) {
        best = { bousdtSize: candidateBousdt, clearingPriceX18: price, delta };
      }
    }
    if (best != null) return best;
  }
  return null;
}

const exactPair = exactPairNearTarget();
if (exactPair == null) {
  throw new Error("could not derive exact-conserving amounts near the target price; try a larger WBOT size");
}

const bousdtSize = exactPair.bousdtSize;
if (bousdtSize <= 0n) {
  throw new Error("WBOT size is too small for a non-zero BOUSDT order at the current price");
}

const clearingPriceX18 = exactPair.clearingPriceX18;
const minBuyBousdt = (bousdtSize * (10000n - priceSlackBps)) / 10000n;
const minBuyWbot = (wbotSize * (10000n - priceSlackBps)) / 10000n;
const totalWbot = wbotSize * pairCount;
const totalBousdt = bousdtSize * pairCount;
const swapWbot = totalWbot * 2n;
const wrapValue = totalWbot + swapWbot;

for (const [key, value] of Object.entries({
  PAIR_COUNT: pairCount,
  WBOT_SIZE: wbotSize,
  BOUSDT_SIZE: bousdtSize,
  CLEARING_PRICE_X18: clearingPriceX18,
  MIN_BUY_BOUSDT: minBuyBousdt,
  MIN_BUY_WBOT: minBuyWbot,
  TOTAL_WBOT: totalWbot,
  TOTAL_BOUSDT: totalBousdt,
  SWAP_WBOT: swapWbot,
  WRAP_VALUE: wrapValue,
  PRICE_SLACK_BPS: priceSlackBps,
})) {
  console.log(`${key}=${value.toString()}`);
}
NODE
)"
eval "$CALCULATED_VALUES"

json_field() {
  node -e '
let data = "";
process.stdin.on("data", (chunk) => { data += chunk; });
process.stdin.on("end", () => {
  const path = process.argv[1].split(".");
  let value = JSON.parse(data || "{}");
  for (const part of path) value = value == null ? undefined : value[part];
  process.stdout.write(value == null ? "" : String(value));
});
' "$1"
}

post_order() {
  local trader="$1"
  local sell_token="$2"
  local sell_amount="$3"
  local min_buy="$4"
  local salt="$5"
  local auth_args=()
  if [[ -n "${AGENT_API_BEARER_TOKEN:-}" ]]; then
    auth_args=(-H "authorization: Bearer $AGENT_API_BEARER_TOKEN")
  fi

  curl -sS -X POST "$AGENT_URL/orders" \
    -H 'content-type: application/json' \
    "${auth_args[@]}" \
    --data '{"trader":"'"$trader"'","batchId":"'"$BATCH_ID"'","sellToken":"'"$sell_token"'","sellAmount":"'"$sell_amount"'","minBuyAmount":"'"$min_buy"'","expiresAt":"'"$EXPIRES_AT"'","salt":"'"$salt"'"}' \
    >/dev/null
}

echo "Nyx demo round"
echo "  reason target: $REASON"
echo "  batch: $BATCH_ID"
echo "  pair count: $PAIR_COUNT"
echo "  WBOT per order: $WBOT_SIZE"
echo "  BOUSDT per order: $BOUSDT_SIZE"
echo "  clearing price X18: $CLEARING_PRICE_X18"
echo "  price slack bps: $PRICE_SLACK_BPS"
echo "  WBOT trader: $DEPLOYER_ADDRESS"
echo "  BOUSDT trader: $COUNTERPARTY_ADDRESS"
echo "  expires at: $EXPIRES_AT"
echo

BEFORE_STATUS="$(curl -sS "$AGENT_URL/status" || printf '{}')"
BEFORE_LAST_TX="$(printf '%s' "$BEFORE_STATUS" | json_field lastTx)"

echo "Preparing tiny live token balances..."
COUNTERPARTY_GAS_BALANCE="$(cast balance "$COUNTERPARTY_ADDRESS" --rpc-url "$RPC_URL")"
if [[ "$COUNTERPARTY_GAS_BALANCE" == "0" ]]; then
  echo "counterparty wallet needs BOT for its approval and submit transactions" >&2
  exit 1
fi
cast send "$WBOT" "deposit()" \
  --value "$WRAP_VALUE" \
  --rpc-url "$RPC_URL" \
  --private-key "$DEPLOYER_PRIVATE_KEY" >/dev/null

cast send "$WBOT" "approve(address,uint256)" "$SWAP_ROUTER" "$SWAP_WBOT" \
  --rpc-url "$RPC_URL" \
  --private-key "$DEPLOYER_PRIVATE_KEY" >/dev/null

DEADLINE="$(($(date +%s) + 900))"
cast send "$SWAP_ROUTER" \
  "exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))" \
  "($WBOT,$BOUSDT,3000,$DEPLOYER_ADDRESS,$DEADLINE,$SWAP_WBOT,0,0)" \
  --rpc-url "$RPC_URL" \
  --private-key "$DEPLOYER_PRIVATE_KEY" >/dev/null

cast send "$BOUSDT" "transfer(address,uint256)" "$COUNTERPARTY_ADDRESS" "$TOTAL_BOUSDT" \
  --rpc-url "$RPC_URL" \
  --private-key "$DEPLOYER_PRIVATE_KEY" >/dev/null

cast send "$WBOT" "approve(address,uint256)" "$NYX_BATCH_AUCTION" "$TOTAL_WBOT" \
  --rpc-url "$RPC_URL" \
  --private-key "$DEPLOYER_PRIVATE_KEY" >/dev/null

cast send "$BOUSDT" "approve(address,uint256)" "$NYX_BATCH_AUCTION" "$TOTAL_BOUSDT" \
  --rpc-url "$RPC_URL" \
  --private-key "$COUNTERPARTY_PRIVATE_KEY" >/dev/null

echo "Submitting commitments and reveals..."
for index in $(seq 1 "$PAIR_COUNT"); do
  SALT_WBOT="$(cast keccak "nyx-demo-$REASON-wbot-$BATCH_ID-$index-$(date +%s)-$$")"
  SALT_BOUSDT="$(cast keccak "nyx-demo-$REASON-bousdt-$BATCH_ID-$index-$(date +%s)-$$")"

  COMMIT_WBOT="$(cast call "$NYX_BATCH_AUCTION" \
    "hashOrder((address,uint64,address,uint256,uint256,uint64,bytes32))(bytes32)" \
    "($DEPLOYER_ADDRESS,$BATCH_ID,$WBOT,$WBOT_SIZE,$MIN_BUY_BOUSDT,$EXPIRES_AT,$SALT_WBOT)" \
    --rpc-url "$RPC_URL")"

  COMMIT_BOUSDT="$(cast call "$NYX_BATCH_AUCTION" \
    "hashOrder((address,uint64,address,uint256,uint256,uint64,bytes32))(bytes32)" \
    "($COUNTERPARTY_ADDRESS,$BATCH_ID,$BOUSDT,$BOUSDT_SIZE,$MIN_BUY_WBOT,$EXPIRES_AT,$SALT_BOUSDT)" \
    --rpc-url "$RPC_URL")"

  cast send "$NYX_BATCH_AUCTION" \
    "submitOrder(uint64,bytes32,address,uint256,uint64)" \
    "$BATCH_ID" "$COMMIT_WBOT" "$WBOT" "$WBOT_SIZE" "$EXPIRES_AT" \
    --rpc-url "$RPC_URL" \
    --private-key "$DEPLOYER_PRIVATE_KEY" >/dev/null

  cast send "$NYX_BATCH_AUCTION" \
    "submitOrder(uint64,bytes32,address,uint256,uint64)" \
    "$BATCH_ID" "$COMMIT_BOUSDT" "$BOUSDT" "$BOUSDT_SIZE" "$EXPIRES_AT" \
    --rpc-url "$RPC_URL" \
    --private-key "$COUNTERPARTY_PRIVATE_KEY" >/dev/null

  post_order "$DEPLOYER_ADDRESS" "$WBOT" "$WBOT_SIZE" "$MIN_BUY_BOUSDT" "$SALT_WBOT"
  post_order "$COUNTERPARTY_ADDRESS" "$BOUSDT" "$BOUSDT_SIZE" "$MIN_BUY_WBOT" "$SALT_BOUSDT"
done

echo "Waiting for agent settlement..."
for _ in $(seq 1 90); do
  STATUS="$(curl -sS "$AGENT_URL/status" || printf '{}')"
  LAST_TX="$(printf '%s' "$STATUS" | json_field lastTx)"
  AGENT_STATE="$(printf '%s' "$STATUS" | json_field agentState)"
  CHAIN_BATCH="$(cast call "$NYX_BATCH_AUCTION" "currentBatchId()(uint64)" --rpc-url "$RPC_URL" | awk '{print $1}')"

  if [[ "$CHAIN_BATCH" -gt "$BATCH_ID" && -n "$LAST_TX" && "$LAST_TX" != "$BEFORE_LAST_TX" ]]; then
    echo "settlement tx: $LAST_TX"
    exit 0
  fi

  printf '  batch=%s agentState=%s\r' "$CHAIN_BATCH" "$AGENT_STATE"
  sleep 2
done

echo
echo "timed out waiting for settlement; latest /status:" >&2
curl -sS "$AGENT_URL/status" >&2 || true
echo >&2
exit 1
