# Nightfall upgrade — local delivery evidence

Prepared on `codex/upgrade` in the isolated `agentofduty-codex-upgrade` worktree.
No push, PR, merge or deployment has occurred. Automatic approval review rejected
publishing to `https://github.com/roryford/agentofduty` pending explicit authorization.

## Playable changes

Three connected encounters now form a complete assault: South Checkpoint,
Lantern Court and North Extraction. Ready and pause freeze combat, death restores
a whole checkpoint, and extraction ends the mission with run statistics.

The rifle has fixed-tick 600 rpm cadence, aim-relative spread, recoil recovery,
sprint recovery, an unobstructed holo sight and animated reload parts. Movement
adds crouch, validated low-obstacle vaulting and delayed health regeneration.
Soldiers perceive, search, reserve cover, flank, fire aimed bursts and reload.
The district has authored routes and landmarks, original articulated assets,
restrained wet materials, directional sound and clear mission/damage feedback.

The upgrade adopts game-lab's coherent asset and presentation passes,
three-tools' declared captures and real-input verification, and silvermoon's
simulation-owned attack phases, named RNG streams and honest GPU measurement.
The source references and original assessment are in UPGRADE_PLAN.md.

## Terminal verification

Executable verification revision: `cc6d549d88107da049ad0c4ddd513bc139fb4814` (game runtime unchanged since
`893184a7cc0dae591c8b20e56b087b707ef75c86`). The final evidence commit only updates this report; locked baselines are unchanged.

| Check | Result |
|---|---|
| `npm run gate` | PASS: 67 tests, production build, 3 seeds × 25 mission/reset assertions, deliberately missing GLB fallback, 12 staged captures, 3 hardware performance encounters |
| `node tools/diff.mjs` | PASS: all 12 locked views, zero differing pixels; separate independent recapture also matched exactly |
| `node tools/route.mjs` | PASS: actual DOM movement/aim/fire/reload through all stages, 11 kills, 0 retries, 33.603 seconds |
| `node tools/play.mjs --seconds 600` | PASS: 601.887 seconds, 233 samples, 89 checkpoint retries; 30-second ready and pause freezes, input cleanup, ADS/fire/reload and bounded resources |
| Strengthened soak report validation | PASS over every original sample; 71,918 fixed ticks, geometries 177–178, textures 29–30, exactly 19 shader programs |
| `node tools/play.mjs --seconds 15` | PASS with the stronger validator inline: 15.482 seconds, 6 samples, plus the same ready/pause/input smoke |
| `node tools/perf.mjs --gpu 0.000001` | EXPECTED FAIL: actual hardware GPU median exceeded deliberately impossible budget; exit 1 |
| Guard fixtures | PASS: demonstrate red for stalled/dead simulation, missing/invalid CLI values, inadequate samples, software renderer, invalid metrics, slow boot and exceeded budgets |
| Blender exporter regression | PASS: successful real modifier application, contextual failure reporting and nonzero CLI exit for an uncaught Python error; subprocess bounded to 30 seconds |
| `lint-fail-open.sh --diff 227edb1` | PASS: 2 Python files checked, 0 findings; this lint does not inspect JavaScript |

The ten-minute recording was acquired before the reviewer requested stronger
stall/death checks. Runtime was unchanged. Those checks were then applied to the
entire original recording, and separately exercised inline by the short live run.
Original report SHA-256:
`6da2b7266e00d3b6f47701a555a912b2ea824acbf30d084975f0402efa4d8e28`.
Local raw results are in `captures/play-report.json`, `soak-validation.json`,
`play-short-report.json` and `route-report.json` (ignored generated artifacts).

Final device gate: Apple M5 Pro, Chrome ANGLE Metal, 2560×1440 backing pixels,
240 samples per encounter. Local cold boot: 704 ms. rAF p95: 16.7–16.8 ms; p99: 16.8 ms.
CPU p95: 2.8 / 2.2 / 2.4 ms. GPU medians: 2.058 / 2.482 / 2.329 ms.
Peak sampled draws: 428 / 204 / 288. The combat capture peaks at 435 draws,
down from 668 before facade batching. No shader compilation occurs after ready.
These are stationary combat measurements, separate from the real-input route.

## Review and practical limits

Independent review drove fixes to lifecycle transitions, GPU liveness, audio,
asset axes, actual posed weapon sockets, glass occlusion, enemy reload/corpse
states, vault bounds and verifier failure handling. The reviewer issued a ship
verdict on `cc6d549d88107da049ad0c4ddd513bc139fb4814`, including the corrected
Blender CLI failure boundary. The final evidence-only commit receives an
exact-head verdict in the session delivery.

The automated route reads exact target positions and navigation, so it proves
functional completion rather than human difficulty or duration. The proposed
5–8 minute experience, sustained aiming comfort and subjective audio mix remain
unverified. Characters use direct-pivot articulation, not cinematic skeletal
clips. Further art and player-led tuning are prioritized in FOLLOWUPS.md.

Three.js remains the only runtime dependency. No paid assets, new runtime
packages, multiplayer or public hosting were added. Full local verification
requires hardware Chrome and Blender (`BLENDER` may name its executable).
