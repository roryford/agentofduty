# AGENTS.md — agentofduty

Canonical instructions for agents working in this repo.

## What this is

Browser FPS: **Three.js r180 + Vite (WebGL2)**. Night rain-slicked street (~120m).
One weapon, one enemy archetype. Cohesion over feature count.

- Original product brief: [`docs/BRIEF.md`](docs/BRIEF.md)
- Session lessons: [`docs/LESSONS.md`](docs/LESSONS.md)
- Optional follow-ups: [`docs/FOLLOWUPS.md`](docs/FOLLOWUPS.md)

## Commands

```bash
npm install
npx playwright install chrome     # once, hardware Chrome for capture/perf/play tools

npm run dev          # local play
npm run build        # vite → dist/
npm run assets       # Blender headless → public/models/*.glb (build-time only)
npm run test         # node behavioural and verifier tests
npm run gate         # tests + build + scenarios + capture + real-GPU perf
npm run play -- --seconds 600  # real-input stability soak
node tools/route.mjs  # real-input automated mission route
node tools/diff.mjs  # pixel-diff captures/ vs baselines/ (exit nonzero on fail)
```

The full test gate includes a real Blender exporter regression: provide `blender`
on PATH or set `BLENDER` to its executable. Shipped GLBs do not need rebaking.

Gate for handoffs: **`npm run gate` green**, then **`node tools/diff.mjs`** if
baselines are locked (update baselines only on intentional visual changes).

## Runtime vs build-time deps

| Layer | Allowed |
|-------|---------|
| Runtime browser | **three** only |
| Dev / CI tools | vite, playwright, pngjs, pixelmatch |
| Asset bake | Blender CLI (`npm run assets`) |

Do not add runtime packages without an explicit decision to expand the brief.

## Architecture

### Engine (`src/core/`)

- `engine.add(SystemClass)` — topo-sort on `static deps`
- Frame order: `fixedUpdate(h)` @120Hz → `update(dt)` → `lateUpdate(dt)` → render
- `ctx.time.alpha` for render interpolation
- Lockstep: no rAF; `window.__PUMP__(n)` after 3-frame boot; `__READY__`
- `ctx.rng` seeded + `.fork()` — **no Math.random in gameplay/visuals**

### Systems (one directory owner each)

| id | dir | notes |
|----|-----|--------|
| physics | `src/physics/` | AABB, raycast, capsule move, surface tags |
| materials | `src/materials/` | procedural PBR + optional Imagine façade |
| sky | `src/sky/` | night fog, fixed point-light count, practicals |
| render | `src/render/` | tone map, prewarm |
| world | `src/world/` | street, nav A*, props |
| player | `src/player/` | FPS controller, death/respawn |
| weapons | `src/weapons/` | hitscan + viewmodel |
| ai | `src/ai/` | squad, pathfind, attack |
| fx | `src/fx/` | tracers, particles, shake |
| audio | `src/audio/` | procedural WebAudio |
| ui | `src/ui/` | HUD |
| mission | `src/mission/` | objectives, checkpoints, completion |

Contract:

```js
static id; static deps = [];
async init(ctx) {}
fixedUpdate(h, ctx) {}
update(dt, ctx) {}
lateUpdate(dt, ctx) {}
resize(w, h, ctx) {}
dispose() {}
```

Rules:

- Do not edit outside your directory (composition root: `src/main.js`).
- Do not import another subsystem’s modules — `ctx.get('id')` / `peek` / `has`.
- Couple via `ctx.events` only (registry in BRIEF).
- Preallocate in `init()`; dispose GPU resources you create.

### Events (canonical)

`weapon:fire` · `weapon:reload` · `weapon:shell` · `bullet:impact` · `bullet:tracer` ·
`damage:dealt` · `damage:taken` · `actor:death` · `player:land` · `player:footstep` ·
`player:state` · `explosion` · `resize` · `combat:hit` · `session:state` ·
`session:reset` · `mission:objective`

- `damage:dealt` is an immutable request handled by the **target**, never the attacker.
- The target emits `combat:hit` and actor-qualified `damage:taken`; see BRIEF for payloads.
- `ctx.session` owns ready/play/pause/death/complete and checkpoint reset.
- Named `ctx.rng.fork(name)` streams isolate gameplay from decorative randomness.
- New event ⇒ new registry row in the same commit (update BRIEF if needed).

### Surfaces

`concrete` · `metal` · `wood` · `dirt` · `sand` · `glass` · `water` · `foliage` ·
`fabric` · `flesh` · `rubber` · `plaster`

## Hybrid art path

```
Imagine textures → public/models/textures/
npm run assets   → public/models/{rifle,enemy,dumpster,car}.glb
runtime          → src/assets/gltf.js (GLTFLoader + fitHeight/fitLength)
```

If a GLB fails to load, systems fall back to procedural meshes.

## Scale sheet (do not invent)

| Asset | Target |
|-------|--------|
| Enemy height | 1.80 m |
| Sedan | ~4.55–4.6 m L × ~1.85 m W × ~1.45–1.5 m H |
| Dumpster | ~2.05 × 1.15 × 1.25 m |
| Player eye | ~1.65 m |

## Known traps

1. **Point-light count** is baked into shader permutations. Keep count constant;
   park unused lights at `intensity = 0`, never flip `visible`.
2. **Prewarm** all materials/programs before ready — zero mid-frame compiles.
3. **Façade windows**: thickness on façade normal (±X for street walls), not always Z.
4. **Death** is a state machine with respawn — don’t early-return out of camera forever.
5. **Viewmodel** coords after Blender export: document any rotation in
   `tools/blender/export_hero_meshes.py` and `weapons` loader together.
6. **Draw metrics:** use `__METRICS__.drawCallsWorld` / `drawCallsView` / `drawCalls`
   (total). Raw `renderer.info` after viewmodel is view-only.

## Play / controls

- Click canvas → pointer lock
- WASD move · Shift sprint · C/Ctrl crouch · Space jump/vault · LMB fire · **RMB or E = ADS** (holo reticle) · R reload
- Escape/blur pauses combat and clears held input.
- Death → KIA overlay → whole-checkpoint restore ~2.5s.
- Clear hostiles and reach each rally point; final extraction requires an 8-second hold.
- Enemies: always full mesh (no far “blob” LOD)

## Baselines

Locked shots live in `baselines/`. After intentional visual changes:

```bash
npm run gate
node --input-type=module -e "import fs from 'node:fs'; const m=JSON.parse(fs.readFileSync('captures/manifest.json')); for(const s of m.shots) fs.copyFileSync('captures/'+s.file,'baselines/'+s.file); fs.copyFileSync('captures/manifest.json','baselines/manifest.json');"
node tools/diff.mjs
```

## Upgrade lifecycle and resolved events

The approved upgrade plan is `docs/UPGRADE_PLAN.md`. Core owns `ctx.session`:
ready / playing / paused / dead / complete. The engine freezes simulation on
ready/pause/complete while menus render. Session alone owns death/retry timing.
`session:reset` restores an entire encounter; systems reset their owned state.

Additional events: `session:state {state,previous}`, `session:reset
{full,spawn,enemySpawns,encounter}`, `mission:objective {index,name}`, and
`combat:hit {target,from,amount,health,headshot,killed,point}`. `damage:taken`
includes `target`; only target=player drives player hurt feedback.
`damage:dealt` is a request; listeners must never mutate it. Targets emit a
resolved `combat:hit`. `weapon:fire` includes the source actor in `from`.

Real GPU verification uses installed Chrome (ANGLE Metal on macOS). Software
rendering is not accepted as evidence of device performance. Pixel output is
capped by total pixels in core resize; render systems must not override it.

The performance budget is centralized in src/core/config.js: CPU submission
p95 16.67ms, GPU p50 8ms, display rAF p95 17.5ms / p99 25ms. The display
p95 tolerance accounts for 60Hz timestamp rounding; it is distinct from CPU
cost. The probe excludes startup and requires fixed-tick progress.
