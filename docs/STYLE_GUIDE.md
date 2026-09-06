# Visual and interaction style

Robot League takes place in a worn, hand-built robot football garage. The art direction uses comic ink, scuffed metal, strong silhouettes, warm workshop light, and compact sports graphics. Borderlands is a stylistic reference; the game's arena, interface, materials, and animation are custom work.

## Palette and materials

| Use | Current anchor |
| --- | --- |
| Dark teal background | `#1b282b` |
| Card/panel background | `#243337` |
| Warm cream text | `#f3e6c8` |
| Primary action and signage | `#f2bd50` |
| Player/team accents | Cyan and rust orange |
| Watti printed taupe / copper face | `#51463e` / `#b97846` |
| Robot ink outline | `#11191b` |
| Scene/fog background | `#303d3d` |

Use `app/globals.css` for base presentation and `app/mobile.css` for compact overrides. Maintain cream-on-dark readability, clear selected states, and visible keyboard focus. Accent colors identify actions and teams; they should not compete with the ball.

`public/textures/ink-metal.png` is the shared neutral wear texture. Arena materials use it directly; Pollen robot materials use triplanar projection so imported models do not require matching UV layouts. Watti follows the creator's physical prototype photograph: matte taupe printed shells, black motors/cables, steel fasteners, copper face and dark optics. Its connected CAD solids receive distinct materials while preserving their geometry; it uses a finer ink contour and no metal wear texture. Expanded back-face outlines define robot silhouettes; arena geometry uses edge lines.

Retain the recognizable CAD shape and assembly. Color and wear can change presentation, but moving a pivot or deleting a structural piece to make a pose easier changes the robot. Respect the separate asset terms in [LICENSES.md](../LICENSES.md).

## Interface

- The visible name is **Robot League**. All application copy, accessibility labels, errors, and arena signs are English. Player-provided nicknames may use other scripts.
- Headlines use condensed Impact/Arial Narrow fallbacks; body and control copy use Segoe UI/Arial. Keep small text readable and avoid long uppercase paragraphs.
- Panels use firm borders, small corner radii, offset ink shadows, and occasional restrained skew/rotation. Main actions are ochre; secondary controls stay quieter.
- Home shows Single Player, Multiplayer and Meet the Robots, with Watti and Microduck on the right and the Reachy referee behind. Put robot/opponent settings inside Single Player; put online choices inside the room, owned by each player. Preserve score/time, energy, charge, connection status, and a direct path back to the menu.
- Credits use verified source links. Optional author/profile fields remain absent until supplied; do not derive identities from local paths or usernames.
- Dialogs have a reachable close control, visible focus, and scrolling content that stays inside the viewport.

## Arena, lighting, and animation

The pitch is painted concrete with low boards, cyan/orange goals, workshop fixtures, and a referee pedestal outside the collision field. Background props support the setting while the playing surface remains easy to read. Keep overhead hanging lamps out of the scene.

The renderer currently uses sRGB output, ACES filmic tone mapping, exposure 1.55, warm key light, cool rim light, hemisphere fill, and soft PCF shadows. Judge material changes in this lighting, not only in an asset viewer.

Watti folds its elbow backward for a kick, with compensating shoulder and neck motion keeping the face toward the ball. A small 3.9–6 cm hop peaks at the 0.19-second contact and lands softly by 0.42 seconds. Keep these motions tied to action time and power, not a separate animation clock.

Background music uses a quiet 0.045 Web Audio gain below the match sound effects. Start it only after user interaction, cycle the two tracks, honor the shared mute control, and pause it when the page is hidden. Do not add audio credits to the interface.

Movement should convey weight: planted Microduck steps, Watti's compression and hops, preparation before strikes, and readable recovery. Walking phase follows traveled distance. Strike contact should align with the shared simulation: tap at 0.09 seconds and kick at 0.19 seconds. Reachy’s head and rods remain mechanically connected through its solver, for both the gliding player and separate referee. Watti has a wide flat white LED diffuser with cyan, blue and violet edges, attached to the head joint at the measured CAD light origin. Its subtle shoulder/elbow/head idle motion yields to movement and strikes; cable endpoints follow their joints. Keep decorative motion from obscuring the ball or score.

## Camera and phone invariants

Desktop gameplay has an overview camera and an overhead option. Both show the complete match area. Home has a separate staged composition; changing its camera should not accidentally change match framing.

Phone gameplay is landscape. Compact layout activates for coarse pointers or landscape height at most 600 px. Preserve:

- Safe-area insets and `100dvh` sizing.
- A left movement stick and independently held right-side RUN, TAP, and SHOOT controls.
- At least 44 px primary touch targets, including dialog close and utility controls.
- Fit the pitch and goals beneath the 52 px top HUD with small edge margins. Use most of the remaining view for play; the referee and workshop may be cropped. Keep thumb controls in translucent lower-corner overlays rather than reserving a large empty band.
- Portrait rotation guidance, cleared controls, and paused solo play. Online play remains server-owned while local controls are blocked.
- Home and setup controls fit at 568×320 and 844×390 without page or panel scrolling. Keep the three home actions on the left with the robot preview visible on the right; setup and room views may use two columns across the screen. Dialog bodies can scroll within the viewport.
- Explain the shot gesture before play and beside the mobile button: hold for power, release to shoot. Show a power percentage and RELEASE while held.

`game/mobile-camera.ts` owns framing geometry. When changing the pitch, goal depth, robot height or HUD reserves, update its bounds and `tests/mobile.test.ts` together. The mobile reference height stabilizes framing when browser chrome expands or collapses.

Performance defaults cap pixel ratio at 1.25 on touch layouts and 1.7 elsewhere; shadow maps start at 1024/2048 respectively. Grain is hidden on compact layouts and reduced-motion settings remove selected decorative transitions. Check these budgets before adding geometry, lights, particles, or fullscreen effects.

## Visual acceptance and task prompt

For a visible change, inspect menu, an active match, and the affected dialog/state in the browser. Include desktop and small phone landscape; use both camera modes when bounds change. Check robot recognition, attached parts, floor contact, ball visibility, unclipped text, focus, touch ownership, and the absence of page scrolling during phone play. Report actual observations rather than claiming a device or frame rate that was not tested.

Example task:

> Update the specified interface element in the existing worn-ink garage style. Preserve the palette, English copy, clear keyboard focus, landscape touch targets, and camera safe regions described here. Inspect the affected screen on desktop and phone landscape, then run the checks relevant to the change.
