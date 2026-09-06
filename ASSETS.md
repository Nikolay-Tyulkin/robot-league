# Asset sources and transformations

See [LICENSES.md](LICENSES.md) for the full license split. The original code is MIT; the CAD-derived robot assets are not covered by a blanket MIT or Apache grant.

## Watti

Watti is [Nikolay Tyulkin’s](https://github.com/Nikolay-Tyulkin) personal robot; its [public project preview](https://github.com/Nikolay-Tyulkin/Watti) is prerelease and is not the download source for the imported CAD. The bundled `public/models/watti/model.glb`, rig and derived QA assets are **CC BY-NC 4.0**, as authorized by its creator. [Notice](public/models/watti/NOTICE.md), [full license](public/models/watti/LICENSE).

The current assembly was reconstructed from `Watti_fusion_snapshot.json` and six component-local STL meshes in `robot_description/meshes/visual`. Every part is included. Fusion component transforms, real joint centers/axes and five joint limits are retained. The older URDF described a different rest assembly and is not the default conversion source. Private source CAD files are not bundled; users can modify the provided GLB/rig without them. Regenerating from CAD requires separately obtaining the matching inputs.

The game adds photo-referenced matte body, black motor and copper front-plate materials, a diffused LED ring, plus authored idle, hopping, joint motion, heading, charging and celebration. Original supplied input files were not modified. Public metadata uses logical filenames and hashes rather than the creator's workstation paths.

## Microduck

Source: Pollen Robotics [microduck_rl](https://github.com/pollen-robotics/microduck_rl/tree/29e887ecfbf5d37144759e5a9f8a176dfb83d547), revision `29e887ecfbf5d37144759e5a9f8a176dfb83d547`. Imported `src/mjlab_microduck/robot/microduck/robot_walk.xml` and **38 visual STL files**. Every source byte was checked against that revision after the initial branch-based download.

The upstream README assigns **3D model files to Creative Commons BY-SA-NC**, without specifying a version. The separate Apache-2.0 file applies to upstream software under its stated scope. Both statements are preserved in [NOTICE.md](public/models/microduck/NOTICE.md) and [LICENSE](public/models/microduck/LICENSE). Do not relicense the geometry Apache-only.

## Reachy Mini

Source: Pollen Robotics [reachy_mini](https://github.com/pollen-robotics/reachy_mini/tree/234a978e4426895fc88d864e7f154643aea77f53), revision `234a978e4426895fc88d864e7f154643aea77f53`. Imported `src/reachy_mini/descriptions/reachy_mini/mjcf/reachy_mini.xml` and **41 visual STL files**, verified against Git LFS SHA-256 identifiers.

The upstream README assigns **hardware design files to Creative Commons BY-SA-NC**, without specifying a version. The SDK/software Apache-2.0 license is retained separately. See [NOTICE.md](public/models/reachy/NOTICE.md) and [LICENSE](public/models/reachy/LICENSE).

The converted head retains a closed six-rod mechanism. `game/kinematics.ts` solves the actual motor/passive joints; do not move the head independently of the rods.

## Geometry and provenance

Both Pollen models were converted from STL/MJCF into GLB, simplified and prepared for the custom comic materials and animation. Visual parts, joint origins and rest poses are preserved. All models use meters, Y-up and source +X forward; the runtime applies its gameplay heading conversion once.

[docs/asset-provenance.json](docs/asset-provenance.json) records pinned source/download URLs, Git blob/LFS hashes, local SHA-256 hashes and final GLB hashes. The original download used branches; the later audit established matching immutable commits. Conversion now pins those verified commits and checks source hashes.

Simplification runs in millimeter space, then converts back to meters. Each mesh has surface-area/bounds guards; difficult parts receive a larger budget or keep the original geometry. Seven-view silhouette comparisons protect the visible shape. [Model QA](docs/model-qa/INTEGRATION.md) documents the method, limits and reports.

## Optional regeneration

Use a Python environment with `numpy`, `fast-simplification`, and `Pillow`. Ordinary game development only needs the committed runtime models.

```sh
python scripts/assets/prepare_assets.py inventory
python scripts/assets/prepare_assets.py download
python scripts/assets/prepare_assets.py microduck
python scripts/assets/prepare_assets.py reachy
python scripts/assets/validate_assets.py scripts/assets/repaired_output
```

For Watti, set `WATTI_URDF_DIR` to the private `robot_description` folder and `WATTI_FUSION_SNAPSHOT` to the matching JSON. Then run `python scripts/assets/prepare_assets.py watti`. `build` rebuilds all three and therefore needs Watti's source inputs. `WATTI_ALLOW_LEGACY_URDF` is an explicit diagnostic fallback, not the recommended current assembly.

Run `python scripts/assets/verify_silhouettes.py <watti|microduck|reachy>` to compare with source meshes, or `python scripts/assets/validate_assets.py public/models` to inspect committed GLBs. Generated output is under `scripts/assets/repaired_output`; copy the GLB/rig and all license/notice files only after visual and numeric review. Source caches and conversion intermediates are ignored by Git and Docker.

When changing a pinned upstream revision, repeat the license/source audit and update provenance before regeneration. The converter intentionally rejects a revision that disagrees with the recorded audit.

## Original texture and screenshot material

`public/textures/ink-metal.png` was created with ImageGen for this game: neutral gray worn metal and ink scratches, without text or objects. Runtime materials tint it. The arena, lines, goals, ball, signs and UI are built by code; no Borderlands assets are used.

Screenshots are real game captures containing separately licensed models. Their notices are in [screenshots/README.md](screenshots/README.md); they are not blanket MIT-only images.
