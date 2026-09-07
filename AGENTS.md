# Robot League contributor entry point

Robot League is a browser football game with Watti, Microduck and Reachy Mini as players, plus a separate Reachy Mini referee. The UI is English. Start with [README.md](README.md), the [documentation index](docs/README.md), [LICENSES.md](LICENSES.md), and the relevant guide below.

## Code map

| Area | Entry points |
| --- | --- |
| Routes, page metadata, styling | `app/page.tsx`, `app/layout.tsx`, `app/globals.css`, `app/mobile.css`, `app/menu.css` |
| Menus, HUD, match flow | `game/Football.tsx` |
| Fixed-step rules, physics, AI, shared types | `game/sim.ts` |
| Three.js lifecycle, input, prediction, camera | `game/engine.ts` |
| Robot materials, animation, mechanism solvers | `game/robots.ts`, `game/kinematics.ts` |
| Arena geometry and sound | `game/arena.ts`, `game/sound.ts` |
| Touch input and mobile framing | `game/touch-input.ts`, `game/TouchControls.tsx`, `game/mobile-camera.ts` |
| Browser socket and authoritative server | `game/network.ts`, `server/index.ts` |
| Admission, HTTP presence and binary transport | `server/admission.ts`, `server/admission-api.ts`, `game/wire.ts` |
| Credits and model provenance | `game/credits.ts`, `game/RobotCredits.tsx`, `ASSETS.md`, `public/models/` |
| Optional CAD conversion and QA | `scripts/assets/` |

Use the [documentation index](docs/README.md) to choose a guide, then read [Architecture](docs/ARCHITECTURE.md), [Style guide](docs/STYLE_GUIDE.md), [Adding robots](docs/ADDING_ROBOTS.md), or [Adding modes](docs/ADDING_MODES.md) before changing those areas.

## Invariants

- Keep authoritative rules in `game/sim.ts`, usable without a browser. Solo and the server run the same 60 Hz simulation. Clients send controls; the server owns online positions, goals, score, and time.
- Preserve lossless binary snapshot/input encoding when extending state or robot kinds; update `game/wire.ts` and round-trip tests. Keep the 200-player admission limit separate from site visitors and opponent search. Cancellation, reconnect and HTTP waiting must not leak slots or bypass FIFO.
- `demo`, `solo`, and `online` describe runtime ownership. They are not a registry of match rule sets. Players, teams, rooms, and the current HUD are hardcoded for two players.
- Keep keyboard and touch input equivalent. Preserve increasing input sequences, single-use shoot/tap/skill edges, pointer ownership, and clearing controls on cancellation, blur, pause, and navigation. E activates the robot skill; Q is the short hit. Skill cooldowns and effects belong to the shared simulation and server snapshots, not UI timers.
- Robot identities and names live in `ROBOT_KINDS`/`ROBOT_NAMES`. Preserve both online selections and per-player model instances, including mirror matches. Each online player changes only their own room selection; a changed pairing resets both ready flags, and choices lock after start. Solo can explicitly choose any robot; random selection excludes the player's kind at each new match.
- Keep real robot shapes, CAD assembly frames, joint limits, and the GLB/rig pair consistent. Preserve distance-driven footsteps and visual contact at the simulation's strike time.
- Preserve landscape phone controls, safe-area insets, readable HUD, and both camera modes. Main menu and mode setup must fit without scrolling at 568×320 and 844×390. Home has three navigation actions and a visible robot preview on the right. Gameplay cameras prioritize the pitch and goals; the referee and garage may be cropped to make play larger. Explain hold-to-charge and release-to-shoot beside the shot control.
- Follow the original worn-ink garage style. Keep UI strings in English and links/credits factual; do not infer a creator's identity or profiles.
- See `LICENSES.md` for asset terms. Code is MIT; Watti assets are CC BY-NC 4.0; Pollen CAD assets retain upstream unversioned BY-SA-NC terms. Apache-2.0 covers applicable upstream software material, not a blanket grant for the CAD geometry.
- Keep secrets, personal filesystem paths, downloaded source caches, and generated build output out of commits. Preserve required notices when importing or changing assets.

## Commands and completion

```sh
npm ci
npm run dev
npm run check
npm run build:container
npm run build:server
```

`check` runs type checking, linting, and tests. `build:container` sets `BUILD_TARGET=docker` and exports the Vinext client; `build:server` compiles the Node server. Docker serves the static client, `/ws`, and `/healthz` from one Node process. `npm run build` is the separate default app build.

Run checks appropriate to the changed behavior. For visual/input changes, also inspect the actual browser at desktop and phone landscape sizes; for online changes, use two clients. Browser QA and routine reversible fixes are part of implementation. Report what changed, how it was verified, and any remaining limitation. Avoid unrelated rewrites or regeneration of model assets for ordinary UI changes.

## Useful task prompts

- “Fix the supplied bug, trace it through the code map, preserve the listed invariants, and run the relevant checks. Include a regression test when it verifies meaningful behavior.”
- “Add the specified robot using `docs/ADDING_ROBOTS.md`; identify every hardcoded selection and rig assumption before editing, preserve provenance, and verify both control schemes.”
- “Add the specified rules using `docs/ADDING_MODES.md`; keep solo/server results aligned and verify queue compatibility, reconnect, and rematch behavior.”
