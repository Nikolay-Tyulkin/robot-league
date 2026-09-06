# Docker and internet deployment

## Local and LAN

```sh
docker compose up --build -d
docker compose ps
docker compose logs -f game
```

The default is `http://localhost:3000`, bound to `127.0.0.1`. The image runs a compiled Node server as the unprivileged `node` user, with read-only filesystem, dropped capabilities, bounded shutdown and an HTTP health check. One process serves the exported frontend, `/ws` and `/healthz`; no database or persistent volume is needed.

Docker builds inside Linux using `npm ci`, exports the client with `BUILD_TARGET=docker`, and compiles the server separately. This preserves the default Sites/Vinext build. The final image contains generated public assets, compiled server/simulation and the ws dependency, not the repository or development server. Static export cannot host future dynamic React server actions/routes; extend the server or select a new runtime deliberately if a feature needs them.

Compose reads its ignored `.env`. Example for a trusted LAN:

```dotenv
BIND_ADDRESS=0.0.0.0
HTTP_PORT=3000
ALLOWED_ORIGINS=
```

Use the host's LAN address on another device. The default empty allowlist requires a browser's Origin to match the requested host. An explicit comma-separated allowlist restricts it to those exact origins. The browser uses same-origin `/ws`; setting `NEXT_PUBLIC_GAME_SERVER_URL` is only needed for a separate frontend and is a **build-time** override. Never put a password in any `NEXT_PUBLIC_*` variable.

For native `npm run dev`, Vite handles client `.env` values. The standalone Node entry reads the process environment rather than loading `.env` automatically. Its `HOST`/`PORT` defaults are `127.0.0.1:8080`; `STATIC_DIR` enables static serving and requires an `index.html` at startup.

## Internet host behind nginx

Inspect the host before making changes: existing containers, listening ports, nginx virtual hosts, available disk/memory and firewall rules. Preserve unrelated applications, certificates and SSH access. Do not reset firewall rules or stop other Compose projects.

1. Use a separate directory and Compose project, for example `/opt/robot-league` and `docker compose -p robot-league`.
2. Bind Docker to loopback. In the server-only `.env`, set `BIND_ADDRESS=127.0.0.1`, `HTTP_PORT=3001` (or another free port) and `ALLOWED_ORIGINS=https://game.example.com`.
3. The Node server sees nginx as one source IP. Set `MAX_CONNECTIONS_PER_IP=512` and `MAX_CONNECTIONS=512` for this proxy topology; apply client-IP connection limits at nginx. The app deliberately ignores untrusted `X-Forwarded-For`.
4. Adapt [nginx.conf.example](../deploy/nginx.conf.example), preserving Host and WebSocket Upgrade/Connection headers. Validate with `nginx -t` before reloading. Map both page and `/ws` to the same container.
5. Point the intended domain at the server and provision a trusted TLS certificate. Use HTTPS/WSS for regular internet use. Without a domain/certificate, a separate HTTP port can provide temporary IP-based access; it does not encrypt room traffic, and browser clipboard/fullscreen support may differ.
6. Allow only the public nginx port(s) in the firewall. Keep the Docker port private. Verify externally, not just with localhost curl.

Docker's published-port traffic may bypass UFW's normal INPUT processing. Binding the container to loopback and using nginx avoids relying on a UFW rule to hide a publicly published Docker port. See [Docker and UFW](https://docs.docker.com/engine/network/packet-filtering-firewalls/#docker-and-ufw) and [nginx WebSocket proxying](https://nginx.org/en/docs/http/websocket.html).

For an IP-only endpoint such as `http://203.0.113.10:3000`, use nginx `listen 3000`, a free loopback container port such as 3001, and that exact public Origin in `ALLOWED_ORIGINS`. Open 3000/tcp in UFW while keeping SSH and existing rules intact. Do not publish 3001 externally.

## Verify and operate

```sh
curl --fail http://127.0.0.1:3001/healthz
node scripts/smoke.mjs https://game.example.com
docker compose -p robot-league ps
docker compose -p robot-league logs --tail=100 game
```

The smoke check downloads the page and all three GLBs, reads notices, then creates and closes a two-player test room over WebSocket. Also check a real browser: models, solo, private-room connection and landscape controls. A local health response does not prove an upstream/provider firewall allows internet access.

The app caps total connections, connections per socket IP, room count and message sizes/rates. These are basic controls, not a substitute for a reverse proxy, monitoring or capacity testing. Rooms/reconnect tokens are in memory; one instance owns its rooms. Multiple replicas require shared room routing/state, not round-robin balancing. Restarting destroys active matches.

For updates, retain the previous source/image, run checks, build a new image, then recreate only this Compose service. Confirm health and the public smoke test. If verification fails, restore the previous image/config and recreate this service. Do not run blanket `docker system prune` or remove unrelated volumes.

## Secrets and distribution

Keep SSH credentials in your SSH agent/password manager. Server `.env`, deployment credentials, certificate private keys and credential screenshots must never enter Git or the image. `.gitignore` and `.dockerignore` exclude local attachments and environment files; review the actual release archive as well.

The bundled game includes noncommercial models. Hosting configuration does not alter asset terms. Read [LICENSES.md](../LICENSES.md), including Pollen's unresolved CC version, before making claims about distribution/commercial rights.
