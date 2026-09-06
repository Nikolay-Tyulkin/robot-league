# Preparing a public release

1. Review [LICENSES.md](../LICENSES.md). Code is MIT; bundled assets are separately licensed. Pollen's exact upstream CC version is **still unresolved**: retain the original notice and obtain clarification before marking the asset-license audit complete. Do not quietly select 4.0 or call the whole game MIT.
2. Verify the creator's GitHub, Instagram, X and Watti project links in `game/credits.ts`. Set repository description/topics and enable private vulnerability reporting in GitHub settings.
3. Run `npm ci`, `npm run check`, `npm run build`, `npm run build:server`, then `docker compose up --build -d` and `node scripts/smoke.mjs http://localhost:3000`. Inspect the actual browser at desktop and phone landscape sizes.
4. Regenerate dependency notices with `npm run notices` after dependency changes. Retain source and license files for every model. When models change, update provenance hashes and run geometry/silhouette/animation checks.
5. Refresh README screenshots from the real game. Avoid private nicknames, credentials, room tokens and private URLs. Preserve the model notices attached to composed screenshots.
6. Inspect `git status --short` and `git ls-files --cached --others --exclude-standard`. Confirm that `.env`, SSH keys, `.codex-remote-attachments`, local agent/session files, private CAD inputs, downloaded source caches, node_modules and generated build directories are absent. Review text for personal paths and secrets.
7. Ensure README links, AGENTS.md and extension guides match the implementation. Record known limitations: two players, one process/in-memory rooms, no horizontal scaling, separately restricted models, physical-device performance still dependent on hardware.
8. Have the maintainer review the release files before publishing. CI validates pull requests; it does not deploy to a server or require deployment secrets.

The root license notice credits “Robot League contributors.” Watti attribution names Nikolay Tyulkin. The prerelease Watti repository is a related project; bundled asset terms are recorded separately.

For deployment updates and rollback, see [DEPLOYMENT.md](DEPLOYMENT.md). A successful build is not evidence that a public server or multiplayer is reachable; test the final URL from outside the host.
