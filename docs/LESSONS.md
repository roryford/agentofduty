# Lessons learned (session 2026-07-28)

Practical lessons from building the gray-box → night street → hybrid-art FPS slice.
Add rows when you rediscover something expensive.

The July sections below preserve historical commands and paths. For current
architecture and verification, use AGENTS.md and docs/EVIDENCE.md. Source art
now lives in art-source/; the runtime facade texture remains under public/.

## 1. Harness first

Phase 0 (engine, lockstep `__PUMP__`, seeded RNG, capture/diff/perf) paid for itself
on every later pass. When art and systems got noisy, we could still prove:

- boot completes
- frames are deterministic under seed
- zero shader compiles after ready

Without that, “looks better” is pure vibes.

## 2. Scale before style

Several “art quality” failures were metric bugs:

| Looked like | Actually was |
|-------------|----------------|
| Floating / weird windows | Boxes thin on **Z**; façades face **±X** |
| Toy cars / bins | Enemy ~1.26m tall; car ~2.5m long |
| Vertical “tower” rifle | Blender/glTF axes vs camera space |
| Pure black props | metalness 1 + no env map under night lights |

**Canonical scale sheet (use this before any export):**

| Asset | Target |
|-------|--------|
| Player eye / capsule | ~1.65m eye, ~1.8m tall |
| Enemy | **1.80m** height |
| Compact sedan | **~4.55–4.6m** L × **~1.85m** W × **~1.45–1.5m** H |
| Commercial dumpster | **~2.05m** L × **~1.15m** W × **~1.25m** H |
| Door / street lamp | ~2.1m door; lamp head ~5m |

Runtime helpers: `fitHeight` / `fitLength` in `src/assets/gltf.js` so export quirks
don’t re-break scale.

## 3. Night lighting is a system

Night was chosen so procedural materials read under falloff. Implications:

- Budget **key / fill / rim + practicals** before more geometry.
- **Fixed point-light count** forever (ballast at intensity 0). Never toggle
  `light.visible` — recompiles every lit material.
- Prewarm programs at boot; target **zero compiles after ready**.
- Wet asphalt needs specular + fill, not just dark albedo.
- Over-emissive windows become stickers; under-lit props become black voids.

## 4. Soft-locks feel like hangs

Death with `if (!alive) return` on both movement and camera, and **no respawn**,
froze the player in a dead state. Dead must be a state machine:

- death cam still updates
- UI + countdown
- auto-respawn (or explicit continue)

## 5. Hybrid art pipeline (what worked)

```
Imagine (albedo / roughness / concepts)
    → public/models/textures/
Blender headless (meters + bevels + UV + pack)
    → public/models/*.glb
Three GLTFLoader + fitHeight/fitLength
    → weapons / ai / world
Procedural fallback if a GLB fails to load
```

- **Imagine** owns surface read (pixels).
- **Blender** owns metric truth (meters).
- **Capture PNGs** are the visual unit tests; re-lock `baselines/` after intentional changes.

```bash
npm run assets   # blender --background --python tools/blender/export_hero_meshes.py
npm run gate     # build + capture + perf
node tools/diff.mjs
```

## 6. Capture-driven iteration

Loop: `capture → read PNG → fix one failure mode → re-lock baselines`.

Faster than debating polish. Diff fails must mean either a real regression or an
intentional baseline update — not “maybe the GPU is different” without a threshold.

Note: use `__METRICS__.drawCallsWorld` / `drawCallsView` / `drawCalls` (total).
Raw `renderer.info` after the viewmodel pass is **view-only** — the engine now
splits world vs view on each frame.

## 7. Subsystem contract discipline

- One directory owner; couple only via `ctx.events` and surface tags.
- Don’t import another subsystem’s modules — `ctx.get('id')` at runtime.
- New events need a registry row in the same commit (see BRIEF + AGENTS.md).

## 8. Scope discipline

One weapon, one enemy archetype, one street. Cohesion over feature count.
A small thing that is solid beats a large thing that is uneven.

## 9. Do differently next time

1. Scale sheet on day one (before first mesh export).
2. Façade windows: thickness on the **normal axis** from the first box.
3. Death/respawn in the vertical slice, not after a hang report.
4. Document viewmodel coord contract next to the Blender script
   (barrel −Z / up +Y in Three camera space after export). *(done)*
5. Separate world-draw vs viewmodel-draw metrics in `__METRICS__`. *(done)*
6. Don’t replace far enemies with LO “blobs” if the player expects full mesh at range.
7. ADS needs a real optic/reticle to look through — FOV alone is not enough.

## 10. Quality bar still applies

When adding art or systems, re-check `docs/BRIEF.md` quality bar and exit gate.
Polish that regresses FPS below budget or unrelated baselines gets reverted.


## Nightfall upgrade — September 2026

- Port patterns rather than engines: game-lab's fidelity comparisons, three-tools'
  separate real-input/repro checks, and silvermoon's named RNG/timing contracts
  fit the existing 120 Hz system architecture without new runtime packages.
- Asset contracts must inspect actual exported transforms and posed attachments.
  Names and a correct mathematical heading do not prove that a rifle faces forward.
- Compare active checkpoint state and disabled dormant colliders; unused pool
  storage need not equal an earlier encounter's unused storage.
- One-second cadence counts can hide tick drift. Test long-run intervals too.
- A renderer can look fast while gameplay is paused. Device gates need GPU timing,
  real frame pacing, simulation liveness, valid samples and demonstrated failures.
- Treat screenshots as evidence: they exposed hidden glass, an obsolete scope,
  an off-center ADS reticle, opaque flash geometry and an offscreen reload.
