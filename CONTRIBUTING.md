# Contributing to Robot League

Robot League is a small browser game built around real robot models, shared football rules, and a custom comic garage style. Contributions should preserve playable behavior on desktop and landscape phones. Start with the [documentation index](docs/README.md), then use [AGENTS.md](AGENTS.md) for the code map and project invariants.

## Set up and verify

Use the Node version required by `package.json`; the Docker image uses Node 24. Install the locked dependencies and start both development processes:

```sh
npm ci
npm run dev
```

Open the web URL reported by the dev server. The match server runs separately in development and receives `/ws` through the web dev proxy. Solo play does not depend on a multiplayer connection. Use `.env.example` for configuration and keep local overrides out of commits.

```sh
npm run check
```

This runs type checking, linting, and the automated tests. Use `npm test` or a targeted test command while iterating. Run the appropriate build when changing client packaging, server compilation, or deployment:

```sh
npm run build:container
npm run build:server
```

The container client build selects `BUILD_TARGET=docker`; the server build emits the Node runtime. Docker serves static files, `/ws`, and `/healthz` from one process. `npm run build` remains the default app build target. See [Architecture](docs/ARCHITECTURE.md).

## Work on a focused change

Read the affected implementation and tests before editing. Describe the intended behavior and keep unrelated formatting, dependency updates, and asset regeneration out of a focused fix. Add a regression test when it demonstrates meaningful behavior; do not add tests that only repeat a trivial implementation detail.

Use the relevant guide:

- [Style guide](docs/STYLE_GUIDE.md) for layout, materials, cameras and phone interaction.
- [Adding robots](docs/ADDING_ROBOTS.md) for assets, rig contracts, selection and animation.
- [Adding modes](docs/ADDING_MODES.md) for rules, protocol, matchmaking and lifecycle.

Run checks appropriate to the change. Browser inspection is part of normal visual and interaction work: test desktop and phone landscape, dialogs, keyboard focus, touch input, and both cameras where affected. For multiplayer changes, exercise two clients and the relevant reconnect/rematch path. Routine reversible fixes and browser QA do not need an extra approval checkpoint.

## Models, attribution, and licenses

Read [LICENSES.md](LICENSES.md) before contributing or redistributing assets. Original application code is MIT-licensed. Watti assets are CC BY-NC 4.0. The upstream Microduck and Reachy Mini CAD notices state BY-SA-NC without a version; retain that wording and the project's notices rather than assigning an unsupported version. The upstream Apache-2.0 software files are not a blanket license for the geometry.

For a new model, provide the author, exact source/revision, applicable terms, and your modifications. Contribute only material you have the right to share under its stated terms. Keep asset terms distinct from the code license, retain required notices, and record provenance in the relevant asset documentation. Do not submit someone else's content with a fabricated grant or profile link.

The committed runtime models are enough to run the game. Source CAD conversion is optional; its private inputs, downloaded caches and intermediate outputs should remain outside the public distribution. Sanitize local absolute paths in manifests, scripts, reports and documentation before committing. Do not add credentials, environment files, local build caches, or personal workstation metadata.

## Pull requests and bug reports

A useful pull request explains the concrete problem, the resulting behavior, and how it was verified. Include screenshots for visible changes and mention any remaining limitation. State the actual commands and browser cases tested. If model files change, include source/license information, a short account of the transformation, and relevant assembly/silhouette checks.

A useful bug report includes reproduction steps, expected and actual behavior, browser/viewport or phone orientation, solo/online context, and any relevant error. Avoid sharing private room tokens, credentials or unrelated personal data.

## Working with an AI coding assistant

Give the assistant the observed behavior or feature requirements, then ask it to read `AGENTS.md` and the relevant guide. A helpful prompt is:

> Make the requested change in Robot League. Inspect the current implementation first, preserve the documented simulation, rig, licensing and mobile invariants, and update all affected client/server paths. Run the appropriate checks and browser cases. Keep the patch focused and summarize behavior, verification, and unresolved limitations.

Review generated code and attribution as you would any other contribution. Do not claim verification that was not performed or assume an assistant can infer missing creator links or asset permissions.
