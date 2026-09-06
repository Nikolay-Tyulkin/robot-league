# Third-party notices

The original Robot League code is MIT-licensed. This does not replace upstream licenses for dependency code, UI components or robot models.

## Robots

Pollen Robotics created the Microduck and Reachy Mini models. Their upstream README explicitly assigns 3D/hardware files to **Creative Commons BY-SA-NC**, with no specified version. Apache-2.0 covers repository software material under its stated scope. Preserve both model notices and upstream software license texts:

- [Microduck notice](public/models/microduck/NOTICE.md) and [upstream software license](public/models/microduck/LICENSE).
- [Reachy Mini notice](public/models/reachy/NOTICE.md) and [upstream software license](public/models/reachy/LICENSE).
- [Watti creator notice](public/models/watti/NOTICE.md) and [CC BY-NC 4.0](public/models/watti/LICENSE).

No upstream `NOTICE` file was found in the inspected Pollen revisions. These `NOTICE.md` documents are Robot League's attribution and modification records; they are not claimed to be upstream Apache NOTICE files. Full scope and the unresolved CC version are in [LICENSES.md](LICENSES.md).

## Dependencies and UI

React/React DOM, Three.js, Vinext, Base UI, shadcn, Tailwind CSS, ws and other packages retain their own licenses. Lucide icons use ISC; preserve its copyright notice. Generated `components/ui` code originated from the shadcn starter and retains the applicable MIT grant; installing a template does not remove upstream rights.

Run `npm run notices` after dependency changes. [The generated notice bundle](public/licenses/THIRD_PARTY.txt) includes the installed license texts of non-development packages from the lockfile and is shipped at `/licenses/THIRD_PARTY.txt`. Dependencies used only to build/test/convert assets are not copied into the final Node runtime, apart from frontend code embedded by the bundler. Consult their distributed packages for tooling license terms. The runtime image retains the ws package and its license in `node_modules/ws`.

## Original visual material

The arena, pitch, ball, comic UI and favicon are created by project code. `ink-metal.png` was generated specifically for this project using ImageGen and is made available under MIT to the extent the project holds licensable rights. No Borderlands artwork, models, logos, fonts or sound recordings are bundled. The style reference does not imply endorsement by its creators or by Pollen Robotics.

Screenshots show separately licensed robot assets and must retain the applicable notices; see [screenshots/README.md](screenshots/README.md).
