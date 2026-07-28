# Original brief (session 2026-07-28)

Preserved for future reference. This is the product/engineering brief the project was built against.

---

Build a browser FPS on Three.js r180 + Vite (WebGL2). Zero external assets: every
texture, mesh, animation and sound is generated procedurally at runtime. It must run
fully offline with no dependency beyond three.

SETTING (fixed, do not deviate): one night-time rain-slicked street, ~120x120m.
Wet asphalt, volumetric fog, a handful of strong practical lights. This is chosen
because procedural materials read as convincing under reflection and falloff and
read as flat plastic under noon sun. Do not build a daylight scene.

SCOPE: one weapon, one enemy archetype, one street. Judge against Call of Duty on
cohesion and feel, never on feature count. A small thing that is perfect beats a
large thing that is uneven — cut content before you cut polish.

## Phase 0 — harness first. Nothing else until this passes.
Build src/core/ + tools/ ONLY:
- Kernel: engine.add(SystemClass), topo-sorted on static deps. Frame order is
  fixedUpdate(h) @120Hz -> update(dt) -> lateUpdate(dt) -> render. ctx.time.alpha
  interpolates render transforms between physics ticks.
- Lockstep mode: engine does not self-schedule; an external driver pumps exactly N
  frames via window.__PUMP__, after a fixed 3-frame boot, then signals ready.
- ctx.rng (seeded, .fork()). Math.random() is banned in gameplay and visuals.
- tools/capture.mjs: headless, seeded, renders a named shot list to PNG.
- tools/diff.mjs: pixel-diff a capture against a locked baseline, exit nonzero.
- tools/perf.mjs: assert p95 frame time, draw calls, and shader-compile count.
Gate: `npm run build && node tools/capture.mjs && node tools/perf.mjs` green.

## Phase 1 — vertical slice, gray-box, no polish.
Move, shoot, raycast hit, damage, one enemy that pathfinds and dies, one room.
Untextured. Gate: it is fun to click for 30 seconds. Lock baseline shots here.

## Phase 2+ — sequential upgrade passes over the slice.
One pass per coupled concern, one owner per pass, never two owners in one
directory at once. Order: materials -> lighting/sky -> render pipeline -> weapon
feel -> ai combat -> fx -> audio -> ui. The game stays playable after every pass.

## Subsystem contract
Directories, one owner each: render, materials, sky, world, physics, player,
weapons, fx, ai, ui, audio. src/core/, src/main.js and tools/ are read-only.

  static id; static deps = [];
  async init(ctx) {}  fixedUpdate(h, ctx) {}  update(dt, ctx) {}
  lateUpdate(dt, ctx) {}  resize(w, h, ctx) {}  dispose() {}

ctx: scene, camera, viewScene, viewCamera, canvas, config, events, input, time,
rng, get(id), peek(id), has(id).

Rules:
- Never edit outside your directory.
- Never import another subsystem's module. Resolve at runtime via ctx.get('id').
- CONTEXT ECONOMY: read this contract + your own directory. Do not read another
  subsystem's source — the event registry and surface tags are the entire
  interface. If you think you need to read it, the contract is missing a row; add
  the row instead.
- Preallocate in init(). Zero per-frame allocation.
- Dispose every geometry, material, texture and render target you create.
- Breaking boot blocks all other work. Build gate before every handoff.

Cross-subsystem coupling goes through ctx.events only. Canonical registry (a new
event requires a new row in the same commit):
  weapon:fire {weapon, origin, dir, seed} | weapon:reload {weapon, phase} |
  weapon:shell {position, velocity} | bullet:impact {point, normal, surface,
  incident, damage} | bullet:tracer {from, to, speed} | damage:dealt {target,
  amount, headshot, killed, point} | damage:taken {amount, from, health} |
  actor:death {actor, point, impulse} | player:land {velocity, surface} |
  player:footstep {position, surface, running} | player:state {stance, sprinting,
  sliding, ads} | explosion {position, radius, damage} | resize {width, height}
damage:dealt is handled by the TARGET, never the attacker; emitters filter self.

Surface tags stamped by physics on every collider, driving fx/audio/decals:
concrete, metal, wood, dirt, sand, glass, water, foliage, fabric, flesh, rubber,
plaster.

## Known traps — do not rediscover these
- Visible point-light count is baked into shader permutations. Toggling visibility
  recompiles every lit material (~640-900ms). Keep the count constant: park
  ballast lights and use intensity = 0.
- Prewarm all shader programs at boot. Mid-frame compilation is the dominant
  stall; target zero compiles after ready.

## Quality bar (binary, checkable — not adjectives)
- Every surface: albedo variation + normal + roughness variation, legible at 0.5m.
- Albedo 0.02-0.9. Metals are 0 or 1. Real-world light intensities.
- Lighting has key/fill/rim separation, contact shadows, AO, bounce.
- No visible tiling; edge wear, grime, varied instance rotation and scale.
- Every action (recoil, impact, footstep, gunfire) has visual + audio + tactile
  response. An impact with no decal, particle, sound and shake is a defect.

## Exit gate — this replaces "until it's perfect"
Ship when ALL are true, then stop:
  1. build + capture + diff + perf all green
  2. p95 frame time under budget at Retina; zero shader compiles after ready
  3. every quality-bar line above passes on the locked shot list
  4. 60s of play with no NaN, no leak, no console error
Critique is allowed exactly twice, at Phase 2 midpoint and at the gate, against
that checklist only. Any pass that regresses fps below budget or changes unrelated
baseline shots is reverted, not debated.

---

## Deviation log (intentional)

| Date | Change | Why |
|------|--------|-----|
| 2026-07-28 | Hybrid art: Imagine textures + Blender GLBs for hero meshes | Procedural boxes hit a quality ceiling; still offline, only `three` at runtime |
| 2026-07-28 | Auto-respawn on player death | Dead state with no respawn soft-locked play (felt like a hang) |

Runtime dependency remains **three only**. Blender is a **build-time** tool (`npm run assets`).
