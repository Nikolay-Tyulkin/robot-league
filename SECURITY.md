# Security

This is a small, single-process game server, not a hardened multi-tenant platform. Room state and reconnect tokens are memory-only and disappear on restart. Players use nicknames; there are no account passwords or payment flows.

Do not put server passwords, SSH keys, access tokens, `.env` files or screenshots containing credentials in Git, issues, logs or container layers. `.codex-remote-attachments/` and local agent folders are excluded from Git and Docker context.

For a vulnerability, use the repository's **Security → Report a vulnerability** feature if enabled. Otherwise contact a maintainer privately using their published profile; do not post exploit details or secrets publicly. No private reporting address has been invented here. Maintainers should enable private vulnerability reporting before public release.

For internet hosting, use an HTTPS reverse proxy, keep the game container bound to loopback, restrict WebSocket origins to the public site, and keep Docker/Node dependencies updated. Docker-published ports can bypass UFW input rules; see [deployment guidance](docs/DEPLOYMENT.md). This server intentionally does not trust `X-Forwarded-For`. Apply real-client rate limits at a trusted proxy when needed.

Keep dependency changes reviewable, run CI on pull requests, and avoid `pull_request_target` jobs that execute untrusted contributor code with secrets. Never expose the Docker daemon over an unauthenticated TCP socket.
