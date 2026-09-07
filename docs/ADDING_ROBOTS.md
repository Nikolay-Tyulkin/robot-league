# Adding a playable robot

This is a checklist for the current implementation, which has three playable kinds, `watti`, `microduck`, and `reachy`, plus a separate Reachy referee. It does not have a generic robot registry. Adding a menu card or a GLB alone does not make a new robot playable.

## 1. Establish source and output

Record the model author, exact source/revision, license statement, and modifications before importing. Follow [LICENSES.md](../LICENSES.md) and [ASSETS.md](../ASSETS.md). Existing MIT application code does not grant rights to a new model. The existing Pollen CAD models retain unversioned upstream BY-SA-NC terms; their software Apache files do not license all geometry. Watti assets use CC BY-NC 4.0.

Place reviewed runtime assets in `public/models/<id>/`: `model.glb`, `rig.json`, and applicable notices/license files. Keep source downloads, private CAD inputs, intermediate output, and personal absolute paths out of published assets.

`scripts/assets/prepare_assets.py` contains `Builder`, `build_mjcf`, `CONFIG`, and the import/download helpers. Its binary STL reader, per-robot simplification budgets, home angles, and download logic are specialized. Check these assumptions before reusing them. The Watti path uses its current Fusion snapshot and component-local STL frames; legacy URDF conversion is explicit opt-in.

The converter writes to `scripts/assets/repaired_output/` by default. Review that output before copying it into `public/models/`. Python dependencies are `numpy`, `fast-simplification`, and `Pillow`; ordinary game development uses the committed assets and does not require conversion.

## 2. Preserve the rig contract

The GLB and `rig.json` must agree:

| Field/structure | Runtime expectation |
| --- | --- |
| Coordinate units | Meters |
| Up and forward | Converted Y-up; source forward +X is rotated to gameplay +Z by `Robot.load` |
| `ModelRoot` | Converts source Z-up and places the lowest geometry at ground height |
| `bounds.size[1]` | Finite positive height; used to normalize playable height to 1.75 |
| `joints[name].node` | Unique existing GLB node name |
| `axis` | Joint-local rotation axis |
| `restQuaternion` | Quaternion in xyzw order |
| `restAngle` / `range` | Radians; range limits the requested absolute angle |
| Hierarchy | Real component frames and pivots, no cycles or ambiguous names |

`Robot.setJoint(name, delta)` computes `angle = clamp(restAngle + delta, range)` and assigns `restQuaternion * axisAngle(axis, angle - restAngle)`. Preserve quaternion multiplication order. Normalize a differently oriented source through an explicit adapter rather than distorting gameplay heading.

Current adapters are model-specific:

- Watti expects `base_yaw`, `shoulder_pitch`, `elbow_pitch`, `neck_pitch`, and `head_yaw`, with its LED diffuser attached to `joint_head_yaw` using the CAD light origin. Photo-based material grouping and cable anchors depend on the current six-link GLB; review those adapters if replacing it.
- Microduck expects five joints per leg plus neck/head joints. `duckLegPose` and `duckStep` in `game/kinematics.ts` use the imported Microduck geometry and native dimensions.
- Reachy uses named motor, passive, and rod nodes with a separately controlled head. `createReachyRodSolver` maintains the closed mechanism and restores the previous valid pose if a target is unreachable.

Do not send a new robot through another kind’s animation branch. Add an explicit adapter/branch and fail clearly when its required joint nodes are missing.

## 3. Update every playable-identity checkpoint

| Checkpoint | Required review |
| --- | --- |
| `game/sim.ts`: `ROBOT_KINDS`, `ROBOT_NAMES`, `RobotKind`, `createMatch` | Extend the shared kind/name list and review deterministic defaults and solo randomization |
| `game/sim.ts`: `SKILLS`, `skillsStep`, `aiInput` | Define the named skill, bounded effects and tactical AI use; preserve the shared 10-second cooldown and input deduplication |
| `server/index.ts`: kind parsing, `join`, `select-robot`, queue pairing, `begin` | Admit the new kind, allocate valid opponents, preserve room selection when starting/rematching and sender ownership/readiness rules |
| `game/engine.ts`: `load`, `startSolo`, `renderState` | Load the asset; name the AI correctly; set appropriate footsteps/presentation |
| `game/robots.ts`: `load`, `animate`, cleanup | Add orientation/material/rig adaptation and animation; retain resource disposal |
| `game/sound.ts`: `step` | Choose an intentional footstep/servo character |
| `game/Football.tsx` | Selector, lobby, score panels, player HUD, and robot-specific help |
| `game/TouchControls.tsx` | Choose the skill icon and retain the mobile cooldown display and independent pointer ownership |
| `game/credits.ts` and `game/RobotCredits.tsx` | Real author/source links and the correct asset terms |
| `game/mobile-camera.ts` and camera tests | Include the robot's maximum visible height and any new bounds |

All players share base movement, collision, energy, and kick values; skills apply brief, bounded exceptions. A visual addition should preserve that balance. Put different movement rules in shared simulation and keep `playerMovementSpeed` and the engine's prediction consistent.

The engine stores independent `Robot` instances per player ID and kind, plus a separate referee. Preserve this separation so mirrored opponents keep independent transforms, animation and team rings. Only active models are visible. Supporting more than two players is a larger rules/network/UI change; see [Adding modes](ADDING_MODES.md).

## 4. Animate from game state

Use `Player.distance` for locomotion cadence and `vx/vz` for activity. Use `action`, `actionTime`, and `charge` for preparation, contact, and recovery. Tap contacts at 0.09 seconds; kick contact is 0.19 seconds. The simulation owns the ball impulse. Presentation should not create another impulse or alter score.

Animate a skill from `skillTime`, using its shared duration constant; `blinded` and `staggered` drive temporary reaction effects. Keep timers and hit detection in the simulation. Clear presentation on kickoff and rematch, and keep ground-contact effects off during airborne skills.

Keep supporting feet planted, interpolate poses smoothly, respect limits, and keep connected components attached. Test both attack directions and both team colors. Give idle, walking, sprinting, charging, tap, kick, and celebration distinct readable states. Reset presentation when a new match begins and dispose added materials/geometries on teardown.

## 5. Verify and document

- Run `python scripts/assets/validate_assets.py public/models` to validate every committed model, or pass the reviewed conversion output directory.
- Compare source/output silhouettes, inspect component frames and joint extremes, and retain the original robot's shape. Simplification already uses area/bounds guards; do not remove them to force a smaller file.
- Add a meaningful regression test for new shared rules or mechanism math. Existing asset validators do not fully test animation behavior.
- Run `npm run check`; build the relevant app/container target when loading or packaging changes.
- Inspect the model in a real match on desktop and phone landscape. Verify both cameras, both sides, touch/keyboard controls, strikes, floor contact, rematch, and resource cleanup where changed.
- Update asset provenance and credits. Document any private input required to regenerate the model without committing that input's workstation path.

## Example AI task

> Add playable robot `<id>` from the supplied source and license information. First list the existing shared selection, per-player instance, and rig assumptions that must change. Preserve the real assembly and create an explicit animation adapter. Update the checkpoints in this guide, keep shared simulation authoritative, and verify gameplay with keyboard and touch. Record provenance and actual validation results; do not invent repository or creator links.
