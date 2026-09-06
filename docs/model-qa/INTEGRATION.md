# Validated repaired robot assets

Deploy `model.glb`, `rig.json`, and each official model's `LICENSE` from these folders. The older `output/` files used a defective meter-scale simplifier and must not be used. `raw_output/` is diagnostic only.

| Model | GLB bytes | Rendered triangles | Height in meters |
|---|---:|---:|---:|
| Watti | 2,124,984 | 88,977 | 0.438842 |
| Microduck | 3,409,356 | 264,340 | 0.271623 |
| Reachy Mini | 2,908,908 | 331,302 | 0.391028 |

Combined GLB payload: 8,443,248 bytes. All original visual parts are included. These totals count repeated mesh instances; GLB geometry buffers are shared.

All assets are meters and Y-up, with source Z-up converted only once at `ModelRoot`, which also grounds the model. Source +X remains +X (forward). Use the named `joint_<source-name>` pivot nodes. Each rig's `joints` dictionary contains `node`, local `axis`, `range` in radians, `restAngle` and `restQuaternion`. For absolute source angle `a`, set quaternion to `restQuaternion * axisAngle(axis, a-restAngle)`.

Watti geometry and joint frames now use the current `Fusion/Watti_fusion_snapshot.json` supplied alongside the project. Each component's `component_frame_in_root` transforms its component-local STL; each important snapshot joint defines the actual root-space pivot and axis. Pivot rest frames remain root-aligned, and all exported joint positions are zero. Do not apply the older URDF's mesh transforms: those belong to an earlier assembly and produce gaps. Watti's snapshot camera confirms +X forward. Snapshot joint limits are preserved.

Microduck uses the official `microduck_rl` `robot_walk.xml`, its visual STL files, and its official home angles. The home angles are already applied in GLB. Reachy Mini uses `reachy_mini` `mjcf/reachy_mini.xml` and Git LFS STL binaries. Exact verified commits and hashes are in `docs/asset-provenance.json`. The repositories' Apache-2.0 software licenses are included, while CAD geometry retains the upstream unversioned BY-SA-NC statement. Read the model `NOTICE.md` files and root `LICENSES.md`; the old blanket Apache model attribution was corrected during publication preparation.

Reachy's head group is `body_xl_330`. Reparent it with Three.js `attach()` before authored head motion because the original MJCF attaches it beneath rod 6. `game/kinematics.ts` in the project provides analytical IK for all six 40mm servo arms and 85mm rods, using the exact source head attachment positions and joint limits. It updates real motor and passive-joint pivots and restores the previous head and body-yaw poses if unreachable. Both antenna joints remain children of the reparented head.

The exact game configuration was numerically tested: scale `1.6/rig.bounds.size[1]` (4.09177981), outer Y rotation -PI/2 and position [0,.22,-5.65]. For yaw [-.85,.85], body yaw -yaw*.25 and local head quaternion `headRest * Euler(0,pitch,-yaw*.12)`, pitch [-.05,.05], a 101-by-21 grid of 2,121 poses had no unreachable branches. Largest absolute servo angle was 0.2102 rad, smallest source joint-limit margin was 0.62755 rad, and maximum endpoint closure error after game scaling was 3.36e-7. Keep these amplitudes and invoke the solver after updating the head/body yaw each frame.

## Repair and validation

The original simplifier used meter-scale coordinates, where the library's absolute thresholds destroyed CAD surfaces. The corrected converter simplifies in millimeters, preserves borders, then returns to meters. Every individual STL is checked for area retention 97.5–102.5% and bounding-coordinate error below 0.8% of its size. Difficult pieces receive a larger triangle budget or retain their original mesh.

An independent seven-view raster comparison checks each repaired part's actual external silhouette against the original STL, so internal surface area cannot hide an absent shell. The `silhouette_report.json` files contain every part and direction. Watti head retains at least 99.15% source silhouette pixels; every Watti part retains at least 98.79%. Official robots retain at least 95.7% across all small mechanical details; their principal shells remain intact. Diagnostic `silhouette_comparison.png` overlays matching pixels in gray, source-only pixels in red, converted-only pixels in green.

The binary validator checks GLB headers, index/accessor bounds, finite positions/normals, normalized quaternions, unique node names, acyclic and complete hierarchy, and all named joint references. Visual QA in the game remains the final check for presentation and animated pose.

## Reproduce

The runtime photo material, light, cable and kick adaptation is summarized in `watti-photo.json`: 721 articulation samples, unchanged CAD triangles, attached LED/cable endpoints and joint limits. Watti's backward elbow stroke is balanced by shoulder/neck rotation; its small hop peaks at the 0.19-second kick contact. These are presentation changes to the committed GLB, not a new CAD conversion.

`scripts/assets/prepare_assets.py` now defaults to corrected millimeter-space processing and writes `repaired_output`. Install NumPy and fast-simplification in your Python environment, then run `inventory`, `download`, and `build`. `WATTI_URDF_DIR` can override the mesh package location and `WATTI_FUSION_SNAPSHOT` the assembly snapshot location. Original files remain unchanged. `scripts/assets/validate_assets.py` verifies all repaired outputs; `scripts/assets/verify_silhouettes.py [watti|microduck|reachy]` creates the independent silhouette reports (requires Pillow).

