# Adding match rules or modes

`GameEngine.mode` currently means `demo`, `solo`, or `online`: who drives the scene and simulation. Match rules are currently fixed in `game/sim.ts`. Treat a new rule set as shared match configuration/state; do not overload the engine's execution mode or implement rules only in React.

## Define the behavior before editing

State the new mode's participants, ball/arena behavior, time limit, win/tie rules, controls, AI support, and availability in solo/private/quick matches. Establish which existing rules it changes. For a mode using the existing two-player pitch, keep the current command and state structure wherever it remains sufficient.

There is no current `MatchRules` registry or mode negotiation API. Add only the interface needed for the requested behavior, then carry it through both local and online startup. Keep the existing mode as the explicit default for old entry points.

## Implementation checkpoints

| Area | Current code to review |
| --- | --- |
| Shared definitions and initialization | `game/sim.ts`: `MatchState`, `Phase`, `createMatch`, constants |
| Rule execution | `step`, `goal`, `finish`, `restartPositions`, `ballStep` |
| AI | `aiInput` and its target/attack assumptions |
| Local startup and prediction | `game/engine.ts`: `startSolo`, simulation loop, online prediction, `snapshot` |
| UI | `game/Football.tsx`: mode entry, help, lobby, score/time, phase/result messages, rematch |
| Client protocol | `game/network.ts`: room/state message types and startup request |
| Server room configuration | `server/index.ts`: `Room`, create/join/queue handling, `begin`, ready/rematch |
| New controls | `Input`, `idleInput`, server `validInput`, keyboard input, `TouchInput`, `TouchControls` |
| Visual bounds and feedback | `game/arena.ts`, `game/mobile-camera.ts`, `Robot.animate`/`referee`, `game/sound.ts` |

Persist the chosen rules with the room so initial start and rematch use the same configuration. Broadcast enough information for the lobby, HUD, reconnect, and result screens to describe the authoritative match. If quick play supports multiple rule sets, pair only compatible requests and clean up each queue correctly.

Keep scoring, timers, movement constraints, and collision changes in shared simulation. The Node server calls the same simulation as solo. Clients send validated inputs, never trusted positions or scores. The engine currently duplicates movement speed/acceleration and field clamps for prediction; update that code when authoritative movement changes.

New action buttons must preserve input sequence handling and single-use edges across all layers. A held action and an action edge are different: cancellation must not synthesize a shot, and a queued edge must survive until one simulation tick consumes it.

## Two-player limits

The current implementation assumes two players in more than room capacity:

- `MatchState.players`, `score`, and simulation inputs are two-element tuples.
- Spawns, attacking direction, goal ownership, player separation and AI use indices 0/1.
- The server preserves each selected kind (including mirrors), pairs two queued clients, starts after both are ready, and uses a binary forfeit winner.
- The renderer holds independent instances per player ID and kind; extra players need additional instances.
- HUD, score panels, team colors, events, winner display, and rematch readiness assume two sides/players.
- The camera bounds describe the current pitch and goals, not arbitrary arenas.

For teams, spectators, extra players or multiple balls, update the affected types, ownership model, lifecycle, renderer instances and UI intentionally. Do not simply increase a room-size constant.

## Time, reconnect, and match lifecycle

Use the existing fixed 60 Hz simulation and maintain the distinction between simulation time and connection deadlines. The server emits snapshots at 20 Hz; the browser sends controls at roughly 30 Hz plus immediate action edges. Avoid frame-dependent gameplay.

Specify the new mode's behavior for countdown, score stoppage, pause, disconnect, match end and rematch. Preserve controls clearing and neutral stale inputs. A reconnect should restore the room's existing rules and authoritative phase; a rematch should create fresh counters, events, positions, action state, and prediction/interpolation state.

When adding phase values, review every phase-sensitive renderer/UI branch and the stored pre-pause phase. Reset events once per new match so old effects are not replayed and new effects are not suppressed.

## Verification

- Add simulation tests for the new start/win/tie/end boundaries and relevant scoring/collision edge cases. Keep the existing mode's tests passing.
- Verify local and server simulation give matching outcomes for controlled input sequences.
- Extend two-client server tests for mode selection, compatible matchmaking, invalid requests, ready/start, reconnect and rematch.
- Test any new action with keyboard and simultaneous touch pointers, including cancellation and blur.
- Update mobile camera projection tests when geometry or HUD reserves change; inspect both camera modes in the browser.
- Run `npm run check`. If state packaging, server entry points or static serving changes, also run `npm run build:container` and `npm run build:server`, then exercise `/healthz`, page loading and a real two-client match in the built runtime.

## Example AI task

> Implement the supplied match rules in Robot League. First identify the shared simulation, room/protocol, UI, and two-player assumptions affected. Keep `demo/solo/online` as execution modes and preserve the current football rules as the default. Carry selected rules through solo, the specified online entry points, reconnect and rematch. Add meaningful rule/lifecycle tests, inspect affected browser screens, and report the checks actually run.
