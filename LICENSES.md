# License scope

Robot League has **MIT-licensed source code and separately licensed, noncommercial robot assets**. The repository as a whole is not an exclusively MIT-licensed distribution. Reading `package.json` or the root `LICENSE` alone is insufficient for reusing the models.

| Material | Terms | Notice |
| --- | --- | --- |
| Original application/server code, scripts, configuration, written documentation, procedural arena, original favicon and ink texture | MIT | [LICENSE](LICENSE) |
| Watti model, rig, silhouette renders/reports in `public/models/watti/`; Watti-derived QA data | CC BY-NC 4.0 | [Watti notice](public/models/watti/NOTICE.md), [full license](LICENSES/CC-BY-NC-4.0.txt) |
| Microduck model and model-derived rig/QA data | Upstream states **Creative Commons BY-SA-NC**, without a version | [Microduck notice](public/models/microduck/NOTICE.md) |
| Reachy Mini model and model-derived rig/QA data | Upstream states **Creative Commons BY-SA-NC**, without a version | [Reachy notice](public/models/reachy/NOTICE.md) |
| Imported Pollen software-description material to the extent covered by the upstream software grant | Apache-2.0, with upstream copyright notices retained | [Microduck software license](public/models/microduck/LICENSE), [Reachy software license](public/models/reachy/LICENSE) |
| Bundled dependencies and generated third-party UI code | Their respective licenses | [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) |
| Screenshots and composed model comparison images | Underlying model terms remain applicable; these are not MIT-only assets | [Screenshot notice](screenshots/README.md) |

## Watti

Nikolay Tyulkin has authorized sharing and adaptation of the bundled Watti assets under **Creative Commons Attribution-NonCommercial 4.0 International**. Credit **[Nikolay Tyulkin](https://github.com/Nikolay-Tyulkin)**, identify Robot League as the source of this adaptation, link to the license, and indicate changes. The related [Watti project](https://github.com/Nikolay-Tyulkin/Watti) is a prerelease preview without a general source-code license; the game-specific asset grant does not relicense that repository.

CC BY-NC 4.0 permits redistribution and adaptation for noncommercial purposes; it does not add ShareAlike. Its full legal text controls. A commercial permission for the Watti asset must come from its rights holder. The MIT license on the surrounding code does not provide that permission.

Noncommercial licensing is **not OSI open source**: the [Open Source Definition](https://opensource.org/osd) requires permitting commercial fields of use. The source code is open source; the models have separate restrictions.

## Pollen model license clarification

The exact imported source revisions were checked on 2026-09-06. Their root `LICENSE` files contain Apache-2.0, but their README license sections explicitly carve out 3D/hardware files under **Creative Commons BY-SA-NC**. We preserve that notice and the Attribution, NonCommercial and ShareAlike conditions for the converted models. We do **not** relabel the geometry Apache-2.0 or assign an unsupported Creative Commons version.

The upstream statements do not specify a CC version or link a complete CC legal code for these models. The notices record this unresolved upstream detail with the local identifier `LicenseRef-Pollen-BY-NC-SA-Unversioned`; that identifier is a record of the statement, not a newly invented license. **A maintainer should obtain an explicit version/applicable grant from Pollen before declaring the public release's asset licensing fully resolved.** No such clarification has been obtained by this project.

Verified statements:

- [Microduck model-source README at 29e887ec](https://github.com/pollen-robotics/microduck_rl/blob/29e887ecfbf5d37144759e5a9f8a176dfb83d547/README.md#license).
- [Reachy Mini README at 234a978e](https://github.com/pollen-robotics/reachy_mini/blob/234a978e4426895fc88d864e7f154643aea77f53/README.md#license).

## Reuse and contributions

You may reuse the MIT code commercially while respecting the separate licenses of every asset you include. Shipping the bundled game includes noncommercial models; an MIT code license does not remove their NC/SA conditions. Replace restricted models and derived media, or obtain suitable rights, for a commercial distribution. Keep independent code and model adaptations clearly separated.

Contribute original code under MIT and asset modifications under the applicable asset terms. Supply provenance and permissions for every new model. Do not submit files under incompatible or unclear licenses and silently label them MIT. See [CONTRIBUTING.md](CONTRIBUTING.md).
