#!/usr/bin/env bash
# Seed four controlled canary rounds through the maintained two-wallet driver.
#
# Required environment:
#   DEPLOYER_PRIVATE_KEY      WBOT-side canary wallet
#   COUNTERPARTY_PRIVATE_KEY  distinct BOUSDT-side canary wallet
#   RPC_URL, NYX_BATCH_AUCTION, WBOT, BOUSDT, SWAP_ROUTER
#
# Both wallets must already be allowlisted and the counterparty must hold a
# small amount of BOT for gas. The auction rejects one-wallet cross-side flow.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DRIVER="$ROOT_DIR/scripts/demo-round.sh"

if [[ ! -x "$DRIVER" ]]; then
  echo "missing executable canary driver: $DRIVER" >&2
  exit 1
fi

echo "Nyx canary sequence: pair, depth, notional, spread"
"$DRIVER" --reason pair --wbot-size 10000000000000000
"$DRIVER" --reason depth --wbot-size 10000000000000000
"$DRIVER" --reason notional
"$DRIVER" --reason spread --wbot-size 5000000000000000

echo "Canary sequence complete. Verify every settlement receipt before raising caps."
