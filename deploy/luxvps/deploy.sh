#!/usr/bin/env bash
set -euo pipefail

# Guarded target-host runner. It is intentionally dry-run unless --execute is
# supplied. Run this from the Nyx checkout on the target host after the agent
# env file and persistent state directory have been provisioned.

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
readonly REQUIRED_SOURCE_COMMIT="9b452a0b70119d0b57694c39763643e982e13ee2"
readonly COMPOSE_FILE="$SCRIPT_DIR/compose.yaml"

mode=dry-run
compose_env="${NYX_COMPOSE_ENV_FILE:-$SCRIPT_DIR/compose.env.example}"

usage() {
  cat <<'EOF'
Usage: deploy.sh [--dry-run|--execute] [--compose-env FILE]

The default is --dry-run. --execute builds and starts the Nyx agent and private
web/proxy services after all guards pass. It never creates or edits the Caddy
configuration and never prints secret values.
EOF
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

warn() {
  printf 'warning: %s\n' "$*" >&2
}

log() {
  printf '%s\n' "$*"
}

while (($#)); do
  case "$1" in
    --dry-run)
      mode=dry-run
      ;;
    --execute)
      mode=execute
      ;;
    --compose-env)
      (($# >= 2)) || die "--compose-env requires a file path"
      compose_env=$2
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown argument: $1 (use --help)"
      ;;
  esac
  shift
done

command -v git >/dev/null 2>&1 || die "git is required"
command -v docker >/dev/null 2>&1 || die "docker is required"
docker compose version >/dev/null 2>&1 || die "docker compose is required"

[[ -f "$COMPOSE_FILE" ]] || die "missing $COMPOSE_FILE"
[[ -f "$compose_env" ]] || die "missing Compose interpolation file: $compose_env"

actual_root=$(git -C "$REPO_ROOT" rev-parse --show-toplevel 2>/dev/null) \
  || die "$REPO_ROOT is not a git checkout"
[[ "$actual_root" == "$REPO_ROOT" ]] || die "unexpected git root: $actual_root"
git -C "$REPO_ROOT" cat-file -e "$REQUIRED_SOURCE_COMMIT^{commit}" 2>/dev/null \
  || die "required source commit is unavailable: $REQUIRED_SOURCE_COMMIT"
git -C "$REPO_ROOT" merge-base --is-ancestor "$REQUIRED_SOURCE_COMMIT" HEAD \
  || die "checkout does not contain required source commit $REQUIRED_SOURCE_COMMIT"

for path in \
  "$REPO_ROOT/agent/package.json" \
  "$REPO_ROOT/agent/pnpm-lock.yaml" \
  "$REPO_ROOT/agent/tsconfig.json" \
  "$REPO_ROOT/deploy/luxvps/Dockerfile.agent" \
  "$REPO_ROOT/deploy/luxvps/Dockerfile.web"; do
  [[ -f "$path" ]] || die "missing deployment input: $path"
done

# Read only the named interpolation values needed for checks. Values from the
# agent env are never printed or sourced by this script.
env_value() {
  local file=$1 key=$2
  awk -F= -v wanted="$key" '
    $1 == wanted { sub(/^[^=]*=/, ""); print; exit }
  ' "$file"
}

agent_env=$(env_value "$compose_env" NYX_AGENT_ENV_FILE)
auth_snippet=$(env_value "$compose_env" NYX_AGENT_AUTH_SNIPPET_HOST)
state_dir=$(env_value "$compose_env" NYX_STATE_DIRECTORY_HOST)
cors_origin=$(env_value "$compose_env" NYX_CORS_ORIGIN)
proxy_network=$(env_value "$compose_env" NYX_PUBLIC_PROXY_NETWORK)
auction_address=$(env_value "$compose_env" NYX_AUCTION_ADDRESS)

[[ -n "$agent_env" ]] || die "NYX_AGENT_ENV_FILE is missing from $compose_env"
[[ -n "$auth_snippet" ]] || die "NYX_AGENT_AUTH_SNIPPET_HOST is missing from $compose_env"
[[ -n "$state_dir" ]] || die "NYX_STATE_DIRECTORY_HOST is missing from $compose_env"
[[ -n "$cors_origin" ]] || die "NYX_CORS_ORIGIN is missing from $compose_env"
if [[ ! "$auction_address" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
  if [[ "$mode" == execute ]]; then
    die "NYX_AUCTION_ADDRESS must be a 20-byte 0x address"
  fi
  warn "dry-run: NYX_AUCTION_ADDRESS is not a concrete 20-byte address; frontend build will be guarded at execute time"
fi

if [[ -f "$auth_snippet" ]]; then
  auth_mode=$(stat -c '%a' "$auth_snippet" 2>/dev/null || true)
  auth_gid=$(stat -c '%g' "$auth_snippet" 2>/dev/null || true)
  [[ "$auth_mode" =~ ^[0-7]+$ ]] || die "cannot stat auth snippet: $auth_snippet"
  if [[ "$auth_mode" != 600 && ! ( "$auth_mode" == 640 && "$auth_gid" == 101 ) ]]; then
    die "$auth_snippet must be 0600 or 0640 with the Nginx group (GID 101)"
  fi
  grep -Eq '^[[:space:]]*proxy_set_header[[:space:]]+Authorization[[:space:]]+' "$auth_snippet" \
    || die "$auth_snippet does not define the Authorization upstream header"
  log "agent auth snippet: present (directive checked; value withheld)"
else
  if [[ "$mode" == execute ]]; then
    die "agent auth snippet does not exist: $auth_snippet"
  fi
  warn "dry-run: agent auth snippet is absent; execute will require it"
fi
proxy_network=${proxy_network:-public_proxy}

required_agent_keys=(
  RPC_URL CHAIN_ID BOT_DEX_PAIR BOUSDT WBOT NYX_BATCH_AUCTION AGENT_ADDRESS
  AGENT_PRIVATE_KEY AGENT_REQUIRE_API_BEARER_TOKEN AGENT_API_BEARER_TOKEN
)

if [[ -f "$agent_env" ]]; then
  # Refuse group/other-readable secret files. Do not inspect values.
  secret_mode=$(stat -c '%a' "$agent_env" 2>/dev/null || true)
  [[ "$secret_mode" =~ ^[0-7]+$ ]] || die "cannot stat agent env file: $agent_env"
  (( (8#$secret_mode & 077) == 0 )) || die "$agent_env must not be group/other-readable"

  for key in "${required_agent_keys[@]}"; do
    grep -Eq "^[[:space:]]*(export[[:space:]]+)?${key}[[:space:]]*=" "$agent_env" \
      || die "agent env file is missing key: $key"
  done
  log "agent env: present (required key names checked; values withheld)"
else
  if [[ "$mode" == execute ]]; then
    die "agent env file does not exist: $agent_env"
  fi
  warn "dry-run: agent env file is absent; execute will require it"
fi

if [[ -d "$state_dir" ]]; then
  state_mode=$(stat -c '%a' "$state_dir" 2>/dev/null || true)
  [[ "$state_mode" =~ ^[0-7]+$ ]] || die "cannot stat state directory: $state_dir"
  (( (8#$state_mode & 077) == 0 )) || warn "$state_dir is not private (recommend mode 700)"
  state_uid=$(stat -c '%u' "$state_dir")
  state_gid=$(stat -c '%g' "$state_dir")
  if [[ "$state_uid" != 10001 || "$state_gid" != 10001 ]]; then
    warn "$state_dir is ${state_uid}:${state_gid}; container user is 10001:10001"
  fi
else
  if [[ "$mode" == execute ]]; then
    die "persistent state directory does not exist: $state_dir"
  fi
  warn "dry-run: state directory is absent; provision it as 10001:10001 mode 700"
fi

compose=(docker compose --env-file "$compose_env" -f "$COMPOSE_FILE")

if [[ -f "$agent_env" && -f "$auth_snippet" ]]; then
  "${compose[@]}" config --quiet
  log "compose config: valid"
else
  warn "dry-run: skipped compose config because the required agent env file is absent"
fi

if docker network inspect "$proxy_network" >/dev/null 2>&1; then
  log "external network: $proxy_network present"
else
  if [[ "$mode" == execute ]]; then
    die "external network is missing: $proxy_network (create it before cutover)"
  fi
  warn "dry-run: external network is absent: $proxy_network"
fi

if systemctl is-active --quiet nyx-agent.service 2>/dev/null; then
  die "host nyx-agent.service is active; stop the old agent before starting this one"
fi

if [[ "$mode" == dry-run ]]; then
  log "dry-run: checkout, secret-file, state, Compose, and single-agent guards passed"
  log "dry-run: would run: ${compose[*]} build --pull nyx-agent nyx-web"
  log "dry-run: would run: ${compose[*]} up -d --wait nyx-agent nyx-web"
  log "dry-run: no files, containers, networks, or services were changed"
  exit 0
fi

"${compose[@]}" build --pull nyx-agent nyx-web
"${compose[@]}" up -d --wait nyx-agent nyx-web

# The container healthcheck validates the agent's chain-backed /health route;
# this second check confirms the process is reachable from its own namespace.
"${compose[@]}" exec -T nyx-agent node -e \
  "fetch('http://127.0.0.1:8787/health').then(async r => { if (!r.ok || !(await r.json()).ok) process.exit(1) }).catch(() => process.exit(1))"

log "nyx-agent is running and healthy"
