# Repository cleanup — 2026-09-08

Prepared on `codex/repo-cleanup`, based on merged PR #1 at
`e687d7b69829f971651408aadb72e0614056ef33`. Reviewed before publication;
the cleanup PR carries the resulting commit history. No merge or deployment is
part of this cleanup handoff.

## Scope reconciled against current main

The initial audit inspected the stale July checkout. After fetching origin,
the merged Nightfall upgrade already supplied fourteen baselines, safe session
lifecycle, actor-qualified damage, checkpoint resets, practice, native-input
verification, hardware performance checks, shared server tooling, geometry
ownership protection and audio-listener cleanup. Those were retained.

This pass updates document status and navigation, separates source art from
shipped assets, minifies production output, removes an unused weapon vector,
and adds source/build receipts plus isolated capture runs and strict visual
comparison. Missing exporter textures now fail explicitly. Source art was moved
byte-for-byte; all four existing GLBs and fourteen baseline images are unchanged.

## Verification

- `npm run gate`: PASS after the compatibility review fix. 89 tests, 75 integrated
  mission assertions over three seeds, missing-GLB fallback, native practice
  controls across three aspect ratios, fourteen fresh exact pixel comparisons,
  and all three hardware performance encounters.
- Apple M5 Pro, ANGLE Metal, Chrome 152.0.7977.76. Performance measured at
  2560×1440: CPU p95 1.3–2.0 ms; rAF p95 16.7–16.8 ms;
  GPU p50 1.39–1.66 ms. Cold local boot 756 ms. Zero post-ready compiles.
- Capture run `run-Io2CEE`, 1280×720, seed 1. Source digest
  `8d4f886f4ad46ec808244f9f8ffd91bea3f23980509697f3da856b2ab6c1bc36`.
  The complete gallery and manifest are generated under `captures/runs/`.
- Additional isolated sabotage run: incomplete manifest, stale source digest,
  changed image with original hash, and changed image with an updated hash all
  make the actual diff command exit nonzero. The last case reached pixel diff
  and rejected a deliberately whitened boot image. Production captures untouched.
- Automated fixtures also reject stale/missing/incomplete builds, changed output,
  missing/mismatched shots, invalid thresholds and missing Blender source images.
- `git diff --check`: PASS. Estate fail-open lint: no findings in the two tracked
  executable files selected by that lint; its tracked-diff scope does not include
  new untracked files. New guard modules were covered by the tests above.
- Output approximately 5.6 MB versus 12 MB for the pre-cleanup upgrade build.
  All seven moved image inputs verified byte-identical against Git.

## Independent review and remaining playtesting

The initial Claude worker attempt failed authentication; implementation
continued locally. Rory subsequently directed this repo to use Codex exclusively
for orchestration, implementation and review; AGENTS.md records that direction.
Claude authentication is not a prerequisite. Independent Codex adversarial
review (Mode A) initially returned fix-first for use of import.meta.dirname,
which is unavailable on Node 18 and early Node 20. The fix restores the existing
fileURLToPath(import.meta.url) pattern. A regression executes the actual helper
with dirname/filename metadata absent, checks repository resolution and real
source hashing, and was demonstrated red before the fix and green afterward.
This simulates the older metadata surface on the current runtime; it is not a
claim that the full gate ran under a separate Node 18 installation.

The same independent reviewer re-reviewed the delta and returned **ship**, with
no remaining findings, for the uncommitted executable snapshot identified by the
source digest above plus tests/tools/evidence.test.mjs. It independently ran the
three evidence tests successfully. The orchestrator then completed the full gate.
No executable edits followed that verdict; this report records its results.
Rory authorized commit, push and PR creation after the successful re-review.

Human pacing, sustained recoil comfort, navigation and subjective audio remain
the player-led items in FOLLOWUPS.md. A new ten-minute soak was not performed
in this cleanup pass; prior soak results remain historical in UPGRADE_REPORT.md.
