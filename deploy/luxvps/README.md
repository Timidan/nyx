# Nyx on LuxVPS

This bundle runs the Nyx settlement agent from the pinned source commit
`9b452a0b70119d0b57694c39763643e982e13ee2` as a non-root Docker container on
LuxVPS. The agent has no published host port. Caddy must be on the external
`public_proxy` network and is the only public entry point.

The bundle deliberately does not edit the shared Caddy configuration or carry
secret values. Keep the populated agent env file outside Git with mode `600`.

## Layout

| File | Purpose |
| --- | --- |
| `Dockerfile.agent` | Multi-stage Node 22.23.1/bookworm-slim image; pnpm 9.15.9; production dependencies only. |
| `compose.yaml` | Internal `nyx-agent` and `nyx-web` services, persistent state bind, external `public_proxy` network, and hardening. |
| `Dockerfile.web` | Reproducible Vite build plus an unprivileged Nginx sidecar for static files and the `/agent` gateway. |
| `compose.env.example` | Non-secret Compose interpolation paths and public origin. |
| `nyx-agent.env.example` | Agent key names with placeholders; copy and fill through the approved secret process. |
| `nyx-agent-auth.conf.example` | Private Nginx bearer-header snippet template for the order route. |
| `deploy.sh` | Guarded preflight/deploy runner; dry-run is the default. |

## Prepare the target

The commands below are examples for the `agentops` account. Adjust paths only
through the Compose interpolation file; do not put private keys or bearer
tokens in that file.

```bash
mkdir -p /home/agentops/nyx
install -d -m 700 /home/agentops/nyx/state
install -m 600 nyx-agent.env.example /home/agentops/nyx/nyx-agent.env
install -m 600 /approved/source/nyx-agent-auth.conf /home/agentops/nyx/nyx-agent-auth.conf
install -m 600 compose.env.example /home/agentops/nyx/compose.env
docker run --rm -v /home/agentops/nyx/state:/state alpine:3.21 \
  chown 10001:10001 /state
```

Populate `/home/agentops/nyx/nyx-agent.env` with the existing deployment's
values. Required names include `RPC_URL`, `CHAIN_ID`, `BOT_DEX_PAIR`, `BOUSDT`,
`WBOT`, `NYX_BATCH_AUCTION`, `AGENT_ADDRESS`, `AGENT_PRIVATE_KEY`,
`AGENT_REQUIRE_API_BEARER_TOKEN`, and `AGENT_API_BEARER_TOKEN`. The Compose
file overrides `AGENT_HOST=0.0.0.0`, `AGENT_PORT=8787`,
`ORDER_STORE_PATH=/var/lib/nyx-agent/orders.json`, and `CORS_ORIGIN` from
`NYX_CORS_ORIGIN`.

Copy the existing mode-600 Nginx auth snippet without displaying it. Compose
mounts it as a private read-only secret into `nyx-web`; the shared Caddy
container never receives the bearer token.

The existing order store must be copied into the state directory before the
target agent starts. Preserve its ownership as UID/GID `10001:10001` and mode
`600`. Copy it only after the source agent is stopped so the two agents never
write the same settlement state concurrently.

Create or verify the external network before starting:

```bash
docker network inspect public_proxy >/dev/null
```

Do not create a second proxy network: the Caddy service and `nyx-agent` must
share the same network object.

## Build and stage

From the checkout at the pinned commit:

```bash
./deploy/luxvps/deploy.sh \
  --dry-run \
  --compose-env /home/agentops/nyx/compose.env
```

The script checks the commit, required input files, secret-file permissions,
state-directory ownership, Compose syntax, external network, and the
single-agent guard. It never prints env values. To stage an image without
starting it:

```bash
docker compose \
  --env-file /home/agentops/nyx/compose.env \
  -f deploy/luxvps/compose.yaml \
  build --pull nyx-agent nyx-web
```

`--execute` is intentionally explicit and runs `build --pull`,
`up -d --wait`, and an in-container health probe:

```bash
./deploy/luxvps/deploy.sh \
  --execute \
  --compose-env /home/agentops/nyx/compose.env
```

The runner does not create state directories, networks, env files, or Caddy
routes. Provision those separately and review the dry-run output first.

## Frontend service

`nyx-web` builds the Vite frontend with the same Node/pnpm pins and serves it
from an unprivileged Nginx sidecar on internal port `8080`. It also owns the
legacy `/agent` gateway semantics, so there is no host frontend runtime or
published port. Compose passes `VITE_AGENT_API=/agent`, the deployed public
auction address, and `VITE_REQUIRE_LIVE=true` as build arguments.

For an artifact-only export, the same result can be reproduced without Docker:

```bash
cd web
corepack enable
corepack prepare pnpm@9.15.9 --activate
pnpm install --frozen-lockfile
VITE_AGENT_API=/agent VITE_AUCTION_ADDRESS=<existing-auction-address> \
  VITE_REQUIRE_LIVE=true pnpm build
```

## Caddy contract

Caddy must join `public_proxy` and proxy the whole Nyx host to
`nyx-web:8080`. The Nginx sidecar then strips `/agent` before forwarding to
`nyx-agent:8787`. The exact `/agent/orders` route is handled first so Caddy
mounts and applies the private auth snippet that the Node agent enforces; the
sidecar also preserves the live route's Origin clearing, 64KB body limit, and
12/minute (burst 20) rate limit. The token is not stored in this repository or
shared with Caddy.

The following is a routing contract, not a file to paste into the shared Caddy
repository verbatim:

```caddyfile
reverse_proxy nyx-web:8080 {
	header_up X-Forwarded-For {client_ip}
}
```

Caddy must not expose either `8787` or `8080` on the host. `GET /agent/health`
should return the agent health JSON. `POST /agent/orders` must arrive at the
Node service as `POST /orders` with the injected bearer header; the sidecar
clears `Origin`, limits the request body to 64KB, and rate-limits the endpoint
before forwarding. Unauthenticated direct access is not an accepted
production path.

## Single-agent cutover

1. Keep the source systemd agent running while the target image and frontend
   are built. Do not start the target agent yet.
2. Check the source service status and make a mode-600 backup of
   `orders.json`.
3. Stop and disable the source `nyx-agent.service`. Confirm no Nyx agent
   process remains before starting the container.
4. Copy the state file into the target bind directory, preserving
   `10001:10001` ownership and mode `600`.
5. Run the guarded script with `--execute` and wait for both Compose health
   checks. Verify `/health`, `/status`, current batch, and persisted order
   counts from inside the proxy path.
6. Enable the Caddy whole-host route and smoke-test the public Nyx page,
   `/agent/health`, and the exact `/agent/orders` rewrite/auth behavior.

There must be only one live settlement agent for the deployed wallet. A
healthy Docker container is not sufficient if the old source service is still
polling the chain.

## Rollback

If target health or public smoke tests fail:

1. Stop the target container: `docker compose ... stop nyx-agent`.
2. Keep the target state file and its mode-600 backup unchanged for diagnosis.
3. Point Caddy back to the old source route, then restart the source
   `nyx-agent.service` only after the target process is confirmed stopped.
4. If the target image itself must be retried, restore the prior image/release
   and state backup before starting it. Never run both agents while deciding.

The on-chain auction and agent wallet are not recreated by this host
migration. Rollback is a process/route/state action, not a contract deploy.

## Verification checklist

```bash
docker compose --env-file /home/agentops/nyx/compose.env \
  -f deploy/luxvps/compose.yaml ps

docker compose --env-file /home/agentops/nyx/compose.env \
  -f deploy/luxvps/compose.yaml exec -T nyx-agent \
  node -e "fetch('http://127.0.0.1:8787/health').then(async r => { const j = await r.json(); if (!r.ok || !j.ok) process.exit(1); console.log('health ok'); }).catch(() => process.exit(1))"

curl -fsS https://nyx.timidan.xyz/
curl -fsS https://nyx.timidan.xyz/agent/health
```

Also confirm that both containers report `ReadonlyRootfs=true`, no published
host port, and healthy status; confirm both services are attached to
`public_proxy`; and compare the migrated `orders.json` checksum with the
post-stop source backup.
