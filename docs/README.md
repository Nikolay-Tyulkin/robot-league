# Robot League documentation

Robot League is a browser football game with one shared simulation, a Three.js renderer and an authoritative multiplayer server. The guides below are organized around the thing you want to do.

## 🚀 Get it running

| Page | What it covers |
| --- | --- |
| [README](../README.md) | Game overview, controls and local quickstart |
| [Deployment](DEPLOYMENT.md) | Docker, local/LAN use, nginx, HTTPS and server operations |
| [Release checklist](RELEASING.md) | Repeatable validation before a public update |

## 🧠 Build something new

| Page | What it covers |
| --- | --- |
| [AGENTS.md](../AGENTS.md) | Code map and non-negotiable gameplay, asset and mobile behavior |
| [Adding a playable robot](ADDING_ROBOTS.md) | Provenance, GLB/rig contract, animation, selection and QA |
| [Adding match rules or modes](ADDING_MODES.md) | Shared rules, rooms, protocol, reconnects and rematches |
| [Style guide](STYLE_GUIDE.md) | Garage art direction, materials, animation, cameras and phone layout |
| [Contributing](../CONTRIBUTING.md) | Focused changes, verification and working with an AI coding agent |

## 🔎 Understand the project

| Page | What it covers |
| --- | --- |
| [Architecture](ARCHITECTURE.md) | React UI, Three.js engine, fixed-step simulation and WebSocket server |
| [Asset inventory](../ASSETS.md) | Bundled models, runtime outputs and their transformations |
| [License scope](../LICENSES.md) | MIT code and model-specific terms |
| [Third-party notices](../THIRD_PARTY_NOTICES.md) | Dependency and upstream notices |
| [Asset provenance](asset-provenance.json) | Exact source revisions and imported-file hashes |
| [Model QA](model-qa/INTEGRATION.md) | Assembly, silhouette and mechanism validation |

## Suggested AI-agent workflow

1. Read [AGENTS.md](../AGENTS.md) and the guide for the task.
2. Inspect the current implementation and tests before editing.
3. Change the shared simulation first when behavior affects solo and online play.
4. Carry the change through UI, input, renderer and server paths as needed.
5. Run the relevant automated checks and inspect the affected browser flows.
6. Update provenance, notices and documentation when assets change.

The current game deliberately has two players, one ball and one football ruleset. Adding teams, multiple balls or a new arena requires coordinated changes across simulation, rooms, rendering and UI; the extension guides name those checkpoints.
