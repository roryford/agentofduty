# Agent of Duty — full upgrade plan

Status: implemented locally on codex/upgrade; final review and stability verification in progress.
Publishing is pending explicit GitHub approval after automatic approval review rejected the push.
Assessment: 2026-09-07, current local main checkout.

## 1. Product target

A complete, replayable 5–8 minute single-player night assault: tight rifle
handling, readable squad combat, finished animated characters, and three
connected encounter spaces in the existing street footprint. Target the feel
of a compact military campaign mission. Preserve the original game's own
identity and use original or appropriately licensed assets.

The player reaches a blocked checkpoint, takes a side route through a courtyard
to clear its defenders, and holds an extraction point. Each encounter teaches
or tests a different decision: aim and fire, change position, manage pressure.

Keep one excellent rifle and one soldier rig with tactical roles. Add crouch
and low-obstacle vaulting; defer slide chains, prone, multiplayer, additional
weapons, progression trees, and large-scale destruction. Keep Three.js as the
only runtime package, WebGL2, offline play, and the existing 120 Hz simulation.
Update BRIEF's scope and event registry deliberately as part of implementation.

## 2. Assessment and confidence

This was a limited interactive assessment, not a completed human-equivalent
playthrough. The build was opened in the in-app browser and native Chrome.
Clicks, Escape, short movement/fire/jump/ADS/reload key presses, and repeated
death/respawn were attempted. Native input visibly reduced ammunition to 27/90.
The automation surface does not expose sustained key holds; timing-sensitive
ADS, recoil tracking, sprinting, and audio quality remain ungraded. Short key
taps can occur between simulation ticks. A failed tap is not proof of broken
game input. At assessment time no new real-GPU measurement had been taken; upgrade measurements are recorded below.

### Observed in the live build

| Finding | Consequence | Upgrade response |
|---|---|---|
| Health falls while the click-to-play prompt is displayed | Players can die before entering the game | Ready state freezes combat; successful pointer lock starts play |
| Escape restores the prompt while the fight continues | No safe pause or focus-loss recovery | Explicit pause state and input reset |
| Enemies persist near spawn across repeated deaths | Restart returns the player to immediate pressure | Restore a whole encounter checkpoint, including enemies and weapons |
| Death camera ends looking into the sky | Death tells little about the cause | Brief readable death view with attacker direction, then retry |
| Soldiers move as rigid figures | Motion undermines the military fiction | Locomotion, aiming, firing, hit reactions, reload and death clips |
| Long repeated walls, luminous window rectangles, harsh wet highlights | Weak sense of place and visual hierarchy | Authored district kit, lighting hierarchy, roughness variation and restrained reflections |
| HUD gives ammo and health but no mission direction | No clear reason to advance | Objective, checkpoint and completion feedback |

### Confirmed in source; behavioural impact still needs targeted tests

- Enemy attacks directly apply damage after a static-obstacle visibility check;
  they do not resolve an aimed shot against the player's current hurtbox.
  Vertical targeting uses fixed heights. Test jumping, crouching and cover.
- AI continuously seeks positions around the player, without a perception,
  cover reservation, burst, reload or retreat state.
- Enemy death immediately hides the mesh. There is no encounter completion
  controller or enemy reset in the current AI system.
- Player movement reads keyboard state without gating it on active play.
  Blur/visibility input cleanup is absent from the input binding.
- Respawn refills ammo but does not reset weapon cooldown, reload, heat, recoil
  or ADS state through an explicit weapon lifecycle operation.
- Both player and enemies emit `damage:taken` without a target actor. The HUD
  compares event health to player health, so enemy damage can be mistaken for
  player damage. Fix the event contract and test both directions.
- Weapon spread adds jitter in world X/Y rather than an orthonormal aim basis;
  test the same spread distribution at several yaw/pitch orientations.
- ADS pose blending occurs in presentation update and influences fixed-tick
  spread. Move authoritative handling state into simulation, interpolate only
  its visual pose.
- Reload is a whole-gun dip; the support hand is hidden during ADS.
- The perf tool forces SwiftShader at 1280×720 and accepts at least 50 ms p95.
  It cannot certify the intended 60 fps device experience.
- Existing captures include lockstep-specific automatic firing. Add replayed
  normal input paths so staging cannot substitute for gameplay verification.

## 3. Lessons to incorporate

| Repo | Adopt | Boundary |
|---|---|---|
| game-lab | Finished characters early, coherent world/viewmodel lighting, reference comparisons, visible milestones, playability separate from screenshots | Do not import an expensive full post-processing chain or a large process framework |
| three-tools | Real-input soak, repeatability, declared shot/scenario manifests, demonstrated failing fixtures | Adapt the useful tools to this engine; no wholesale kernel replacement |
| silvermoon | Data-driven attack phases, named RNG streams, simulation-owned combat, asset scale/budget checks, real GPU measurement, total-pixel cap | Keep this game's 120 Hz tick and FPS collision; do not transplant 2D boss geometry or NPR shading |

Sources: ../game-lab/10-FIDELITY-LESSONS.md,
../game-lab/21-FIRST-INCREMENT.md, ../game-lab/12-LOOP-DESIGN.md,
../three-tools/kit/tools/play.mjs, ../three-tools/kit/tools/repro.mjs,
../silvermoon/COMBAT_FRAMEDATA.md, ../silvermoon/AGENTS.md,
../silvermoon/src/sim/core/rng.ts. Recheck applicable instructions before reuse.

## 4. Orchestration and ownership

I own scope, integration, shared contracts, milestone sequencing, evidence,
and the final acceptance decision. Workers receive bounded tasks, exact file
ownership, acceptance scenarios, and the relevant contract. They report changed
files, checks, artifacts, limitations and the precise revision reviewed.

Use named resumable workers, normally two implementers at once, with the third
slot available for independent review. No simultaneous owners of a directory.
Each worker has an isolated worktree; nobody edits the shared main checkout.
Start worktrees from the default branch. Integrate dependency milestones before
starting downstream branches, avoiding a web of mutually dependent PRs.

| Owner | Responsibility / exclusive files when assigned |
|---|---|
| Orchestrator | src/main.js, src/core/, shared contracts, docs, integration decisions |
| Combat worker | src/player/, src/weapons/, src/physics/ in handling phase; src/ai/ in squad phase |
| Art/world worker | src/world/, src/materials/, src/sky/, src/render/, src/assets/, tools/blender/, public/models/ |
| Presentation worker, later | src/ui/, src/audio/, src/fx/ after the damage/weapon/mission contracts settle |
| Verification worker, when scheduled | tools/ outside tools/blender/, tests/ and scenario manifests |
| Independent reviewer | Read-only review of integrated current head and evidence; no implementation edits |

These are sequential assignments, not six concurrent agents. Asset authors
deliver clips and attachment contracts; only the combat owner wires them into
player/weapon/AI source. Orchestrator alone approves new event rows. Add any
new mission/content directories to AGENTS ownership before assigning them.

Worker routing update: Rory explicitly instructed “don't use Claude” after
Claude OAuth prevented dispatch. Implementation uses named Codex-native
workers with explicit models; no Claude processes or nested delegation.
Independent review is dispatched separately from implementation.

For implementation, use Conventional Commits and an early draft PR per
milestone once the first full local gate passes. Local checkpoint commit may
follow compilation, but every push still requires the full local test gate.
Commit/push/PR actions need authorization; this plan itself performs none.
Merge only after independent review and green required checks. Follow estate
App identity, merge and clean-worktree rules. Report terminal CI results.

## 5. Delivery sequence

### M0 — make the game safe to enter and test

Owner: orchestrator plus combat worker; art worker can independently inventory
assets and produce a bounded visual proposal without editing runtime consumers.

- Ready/playing/paused/dead/complete lifecycle; freeze simulation appropriately.
- Pointer-lock failure feedback, Escape/focus-loss pause, clear held input on
  blur and resume. Start click cannot also spend a bullet.
- Full checkpoint reset, including enemies, RNG policy, player, weapon timers,
  temporary FX and HUD. Retry cannot inherit enemies camping the start.
- Actor-qualified damage events and immutable outcome notifications.
- Safe practice staging in development to examine recoil, ADS and reload.
- Establish real GPU renderer identification and a baseline at declared pixel
  sizes. Keep software capture measurements separately labelled.

Acceptance: 30 seconds on ready/pause does not change health or enemy state;
three death/retry cycles restore identical encounter starts; enemy damage never
triggers player damage feedback; loss of focus never leaves firing/movement held.

### M1 — one finished rifle and responsive movement

Combat lane and asset lane proceed against an agreed rig/attachment contract.

- Fixed-tick handling state: hip, ADS, sprint, sprint recovery, reload, dead.
- Frame-rate-independent recoil impulse/recovery; accurate aim-relative spread;
  separate camera recoil from decorative gun motion.
- Configurable sensitivity, ADS sensitivity, FOV, invert Y, reduced camera motion.
- Authored hands and rifle with idle, fire, ADS, sprint and magazine reload clips.
  Distinguish empty/tactical reload only if supported by the chosen rig.
- Crouch with clearance checks, reliable steps/slopes, jump edge triggering and
  low-obstacle vaulting with a validated landing point. Weapon lowers near walls.
- Regenerating health after a tunable damage-free delay supports cover/recovery.

Starting tuning proposal, not measured final truth: retain 600 rpm and a
four-body-shot close-range kill; ADS around 180–220 ms; sprint-to-fire around
200–250 ms; regeneration starts after roughly 4 seconds without damage. Store
durations in ticks at 120 Hz and tune through play, not documentation alone.

Acceptance: visible reticle and shot agree at near/mid/far ranges; fire cadence
and spread do not depend on presentation FPS or facing; reload cannot duplicate
ammo; death/pause/retry from every handling state is clean; crouch/vault cannot
enter solids. A human sustained-input pass grades recoil and handling comfort.

### M2 — one convincing squad firefight

- Perception and last-known position; reaction time before first shot.
- Acquire → aim → burst → recover/reload, with actual shot/hurtbox resolution.
- Accuracy depends on range, movement and sustained exposure; no guaranteed
  offscreen damage timer. Consistent vertical aim and cover occlusion.
- Authored cover anchors with occupancy reservations; limited concurrent flankers;
  separation and stuck recovery; no privileged knowledge behind walls.
- Shared soldier archetype with holder/advancer/flanker assignments.
- Aim and locomotion blending, muzzle cue, hit reaction, bounded corpse lifetime.

Acceptance: solid cover blocks shots; breaking visibility changes pursuit to
last-known position; flanking has a readable route; enemy fire/reload states
match animation; complete the encounter with several seeds without stuck AI.
Tune pressure by encounter composition and timing, not extra health alone.

### M3 — complete mission and authored level

- Rework the existing footprint into checkpoint approach, side-route courtyard,
  and extraction hold. Build tactical layout before decorative detail.
- Encounter triggers, objective updates, checkpoint snapshots and extraction
  completion. Prevent enemies spawning in visible occupied space.
- Mix protected positions and exposed crossings; support both a direct and a
  flank route. Verify player and AI traversal against the same physical layout.
- One memorable landmark per space; doors, shopfronts, signs, cables, drains,
  broken masonry and grounded props communicate a specific place.
- Mission end screen: completion time, accuracy and retry; no progression system.

Acceptance: unfamiliar player can identify the next objective; both routes are
viable; every checkpoint can restart; mission can win and lose cleanly; restart
after completion restores all state. Target duration is validated by play.

### M4 — unified visual, audio and feedback pass

- Cohesive rifle/soldier/prop materials, real scale, normals and roughness maps.
- Key/fill/rim hierarchy, lower window dominance, world-consistent viewmodel
  illumination. Establish readable enemies before adding atmospheric density.
- Budgeted contact shadows, localized fog, rain and wet-surface variation.
  Profile each effect. Avoid blanket SSAO/SSR/DOF/motion-blur additions.
- Layered gunfire, mechanical reload cues, near misses, directional enemy fire,
  surface footsteps/impacts, rain ambience and encounter music states.
- Directional damage, clear hit/kill confirmation, objective presentation,
  pause/settings and accessible text contrast. Optional captions for vital cues.
- Bounded reference comparison: rank gaps across the full shot set, fix the top
  three in each of two passes. Remaining gaps are recorded, not hidden.

Acceptance: all declared gameplay views retain aiming readability; audio cues
identify threats without relying on visuals; target GPU budget remains met;
before/after evidence shows the entire manifest, not selected flattering shots.

### M5 — integration, adversarial review and delivery

- Full local build, behavioural suite, deterministic capture/repro/diff, real
  input soak and device performance. Every new guard has a demonstrated red.
- Review reset during reload, ADS while sprinting, jumping behind low cover,
  focus loss with a held trigger, empty ammo, dead targets, stuck navigation,
  missing assets and repeated mission restarts.
- Independent reviewer inspects the exact integrated revision. Fix findings,
  rerun affected full gates, then obtain a current-head verdict.
- Deliver a playable build, short changelog, controls, evidence and remaining
  limitations. Publishing requires a selected deployment destination and its
  normal authorization; no hosting migration is part of the gameplay scope.

## 6. Shared contracts to settle before parallel implementation

- Lifecycle and checkpoint reset ownership, including deterministic RNG reset.
- Damage request versus resolved hit/death; explicit source and target actors.
- Weapon handling snapshot for UI/animation/audio; reload phase timing.
- Enemy pose/intent snapshot, cover identifiers and navigation queries.
- Mission objective/checkpoint notifications and data schema.
- Rig units, axes, named bones, clip names, muzzle/magazine/hand attachment points.
- Stable named RNG streams: AI, weapon spread, world decoration, visual FX/audio.
  Adding a visual random choice must not change combat outcomes.

Prefer small plain-data state modules within owned subsystems. Extract enough
simulation to test without Three/DOM; do not schedule a whole-engine rewrite.
Notifications use events; declared read queries use services. No implicit
cross-system mutation or listener-order-dependent damage results.

## 7. Evidence and performance targets

Capture manifest: ready/spawn, hip fire, ADS, reload midpoint, near enemy, enemy
behind cover, courtyard, extraction, damage, death, victory, pause/settings.
Include representative 16:9 and taller-window layouts; deterministic world
captures and live UI/input tests have distinct responsibilities.

Behaviour scenarios: safe start; input focus; weapon timing/ammo; facing-invariant
spread; cover at multiple heights; encounter win; player loss; checkpoint reset;
complete mission reset. Assert intended events/state, not merely no exceptions.

Device targets are proposed acceptance budgets, not claims about today's build:

- 60 fps on the named Apple-silicon test machine; record GPU/browser/window.
- Starting cap of 2560×1440 total backing pixels; preserve aspect ratio and allow
  quality scaling. UI remains sharp at display resolution.
- Frame p95 targets 16.7 ms (gate tolerance 17.5 ms for vsync timestamp
  rounding) and p99 ≤ 25 ms in declared combat routes; report CPU and GPU
  separately, use GPU timer queries for headroom, and record sample counts.
- Zero shader compiles after ready; cold time-to-playable ≤ 8 seconds locally
  with cached assets. Network cold-start is a separate measurement.
- Initial combined world/view draw-call budget ≤ 300, revised only against
  measured device headroom and documented quality tradeoffs.
- Ten-minute mixed-play soak and repeated restart test without console errors,
  monotonic resource growth, invalid transforms, stuck input or soft locks.

Audio assessment and sustained pointer-lock aiming remain explicit manual
acceptance items until the available automation can actually exercise them.
Never substitute a screenshot or injected simulation state for those claims.

## 8. Risks, scope controls and approval

The largest uncertainty is a coherent licensed arms/rifle/soldier animation set.
Inventory existing files first; verify licensing, clip compatibility and scale
in a small integration before depending on it. No asset purchases are assumed.
If assets require a purchase, present the exact pack, license and price then.

Cover AI depends on the level's authored anchors; the rig depends on the weapon
attachment contract; final lighting depends on actual materials. Freeze these
interfaces early and integrate at each milestone. Do not let art delivery wait
until the mission is already otherwise finished.

Implementation approval covers the proposed product scope and sequence. Confirm
commit/push/draft-PR authorization before launching that workflow. Paid assets,
new runtime dependencies, and a public deployment remain separate decisions.
Estimate the remaining work after M0/M1 expose input, asset and GPU constraints;
do not promise a calendar date based only on source inspection.

## 9. Upgrade evidence and remaining acceptance

Implemented: session lifecycle and whole-checkpoint reset; fixed-tick rifle
handling and recoil; crouch/vault/regen; cover/perception/burst/reload squad AI;
three authored encounter spaces; original articulated assets; HUD/settings and
rally guidance; directional procedural audio, near misses and ambience; impact
marks; deterministic and real-input verification.

The first complete local gate passed 54 behavioral/asset/verifier tests, three
seeded integrated mission/reset runs, deliberately missing-model fallback, and
12 staged captures. On Apple M5 Pro / Chrome Metal at 2560x1440, per-encounter
GPU medians were 1.30–1.47 ms and rAF p95 16.7–16.8 ms. Local boot was 1.09 s.
Peak sampled draws were 428/204/288; checkpoint capture peaked at 435 after
instancing the windows (down from 668). The initial aspirational 300 total draws
is superseded by the existing 512 gate: preserve authored detail within the
measured GPU headroom, and keep the stricter zero-new-program requirement.

Real-input smoke passed deploy/no accidental shot, movement, held ADS/fire,
reload/refill/conservation, held-input Escape cleanup, and 30-second ready/pause
freezes. Native Chrome also accepted Deploy/movement/Escape. Embedded automation
may not grant pointer lock; its failure leaves the game safely on the briefing.
An automated DOM-input route cleared 11 hostiles and completed all stages in
33.5 s with no retry. It uses exact scene-state aiming and navigation, and does
not establish human mission duration, difficulty, or aiming comfort.

The 5–8 minute human mission-duration target and subjective recoil/audio grading
remain unverified. The assets use lightweight articulated pivots, not cinematic
motion-capture clips. These limits should guide a player-led tuning pass rather
than be hidden behind scripted capture or synthetic timing claims. No runtime
packages, paid assets, multiplayer or public deployment were added.

Independent review found and drove fixes for simulation transition/liveness,
death audio, model axes and attachment transforms, hidden window panes, enemy
reload interruption, corpse cues, collision-constrained AI/vault motion, and
long-run rifle cadence. Final current-head verdict and soak result are recorded
in the session delivery report.
