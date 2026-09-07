# Agent of Duty

Browser FPS — **Three.js r180 + Vite (WebGL2)**. Operation Nightfall: breach a checkpoint,
flank through Lantern Court, and secure extraction with one rifle and one squad archetype. Built for cohesion and feel over feature count.

![Night street gameplay](baselines/combat.png)

Nightfall shipped to `main` in [PR #1](https://github.com/roryford/agentofduty/pull/1).
The image above is a September staged regression capture. See
[verification and visual evidence](docs/EVIDENCE.md) for provenance and current checks;
[follow-ups](docs/FOLLOWUPS.md) tracks remaining human playtesting and polish.

## Quick start

```bash
npm install
npx playwright install chrome     # hardware Chrome for capture/perf/play tools
npm run dev
```

**Play in Chrome:** Deploy captures the mouse. WASD move · Shift sprint · C/Ctrl crouch ·
Space jump/vault · LMB fire · RMB/E aim · R reload · Escape pause.
The briefing and pause freeze combat; death restores the current checkpoint after
2.5 seconds. Clear each area, follow the rally marker, then hold extraction for
eight seconds. Choose **Explore / no enemies** in the briefing or pause menu to
test freely with unlimited reserve ammo, a starting-area selector and Reset Position.
Settings include look/aim sensitivity, FOV, inverted look,
reduced camera motion, and volume.

Enemies react to visibility, use cover and a flank route, fire aimed bursts,
and reload. Break sight and take cover to regenerate health after four seconds.

## Quality gate

Install Blender on PATH (or set `BLENDER` to its executable) for the exporter
regression test. Rebuilding the shipped meshes remains optional. Hardware Chrome
and GPU timer queries are required for the device performance gate.

```bash
npm run gate                  # tests + build + scenarios + practice + fresh visual diff + GPU perf
npm run visual                # fresh capture + diff (requires a current npm run build)
npm run play -- --seconds 600  # real-input smoke and ten-minute stability soak
node tools/route.mjs           # automated real-input mission completion
```

## Docs

| File | Purpose |
|------|---------|
| [`AGENTS.md`](AGENTS.md) | Build/test, architecture, traps (agents) |
| [`docs/EVIDENCE.md`](docs/EVIDENCE.md) | Current verification, capture provenance and baseline review |
| [`docs/CLEANUP_REPORT.md`](docs/CLEANUP_REPORT.md) | September cleanup results and independent review |
| [`docs/BRIEF.md`](docs/BRIEF.md) | Original product brief |
| [`docs/LESSONS.md`](docs/LESSONS.md) | Lessons from the first full build session |
| [`docs/UPGRADE_PLAN.md`](docs/UPGRADE_PLAN.md) | Implemented upgrade plan, with proposed tuning targets |
| [`docs/UPGRADE_REPORT.md`](docs/UPGRADE_REPORT.md) | Local delivery evidence and limitations |
| [`docs/PRACTICE_FIXES.md`](docs/PRACTICE_FIXES.md) | Aiming, boundary and practice follow-up |
| [`docs/FOLLOWUPS.md`](docs/FOLLOWUPS.md) | Optional next steps |

## Hybrid art

Original hero meshes (rifle, articulated soldier, dumpster, car) are baked with
Blender and the procedural/Imagine texture inputs in `art-source/`. Runtime GLBs
and the separately loaded facade texture live under `public/models/`.
The soldier uses named limb pivots with runtime pose animation; these are not
motion-captured skeletal clips. Missing models fall back to procedural meshes.
Runtime dependency remains **three only**.

```bash
npm run assets   # tools/blender/export_hero_meshes.py → public/models/*.glb
```

Production builds are minified. Use `AOD_DEBUG_BUILD=1 npm run build` to include
source maps for debugging. Source artwork is retained but excluded from `dist/`.

## Stack

- Engine: fixed step 120Hz, lockstep for tools, seeded RNG
- Systems: physics, materials, sky, world, player, weapons, ai, mission, fx, audio, ui
- Tools: `tools/capture.mjs`, `diff.mjs`, `perf.mjs`

Capture staging, deterministic lifecycle scenarios, and real-input play have
different jobs. The route controller reads scene state for precise automated
aiming/navigation, so its completion time is not a human difficulty measurement.
GPU checks require hardware Chrome and timer-query support; software rendering
cannot certify performance. Visual baselines are specific to the recorded GPU.
