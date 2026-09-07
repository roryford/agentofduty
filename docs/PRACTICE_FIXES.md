# Aiming, containment and practice follow-up

Historical verification record, merged with the upgrade in PR #1 on 2026-09-07.
See [EVIDENCE.md](EVIDENCE.md) for current capture and gate instructions.

Implemented locally on `codex/upgrade`, following approval to proceed as
orchestrator. Runtime and executable verification revision:
`18679d1210c95ea4fc1f3e2ee00f4bee9fe47833`.

## What changed

- The canvas now follows actual viewport dimensions after panel/window resizing.
  Previously its explicitly assigned CSS size was reused, moving the HUD center
  away from the rendered game's center. The real-input probe reproduced this.
- The ADS marker stays on the aim axis instead of following decorative gun
  movement. Hip/transition crosshairs remain visible until the effective sight
  is shown. Ancestor visibility is part of the weapons presentation contract.
- Continuous visible perimeter barriers block rear, side, corner, jumping and
  vaulting escapes. A lot underlay closes interior floor gaps, including the
  west rear strip. Out-of-bounds/below-world recovery restores the checkpoint.
- Choose **Explore / no enemies** under MODE in the briefing or pause menu.
  Select any starting area, deploy, and test without enemies or mission
  progression. Magazines and reloads stay normal, with unlimited reserve ammo.
  **Reset Position** returns to the selected area. Switching back to Mission
  restarts the first encounter with ordinary ammunition and enemies.

## Verification

| Command / evidence | Terminal result |
|---|---|
| `npm run gate` | PASS: 82 tests, build, 75 seeded scenario assertions, missing-model fallback, actual-input practice probe, 14 captures, three hardware GPU encounters |
| `node tools/practice.mjs` (included in gate) | PASS: real mode/area selection, rear/side movement, ADS while moving/firing, three aspect ratios and FOV 65/80/100, reload, position reset and return to mission |
| `node tools/route.mjs` | PASS: ordinary mission completes using DOM inputs; 11 kills, 0 retries, 33.312 seconds with exact automated aiming/navigation |
| Independent capture + `node tools/diff.mjs --capture /tmp/aod-practice-repro` | PASS: all 14 reviewed baselines match with zero differing pixels |
| Failure fixtures | PASS: displaced/hidden sights, ignored ADS, frozen/no movement, ignored trigger/reload, invalid mode/area, boundary and floor failures are detected |
| `git diff --check` | PASS |
| `lint-fail-open.sh --diff bc2642d` | PASS, zero applicable shell/Python files; not JavaScript coverage |
| Independent source review | Ship on executable revision above; final baseline/prose commit reviewed separately in session delivery |

Device: Apple M5 Pro, Chrome ANGLE Metal, 2560×1440 backing pixels, 240 samples
per encounter. Local boot 1.077 seconds; rAF p95 16.7–16.8 ms; GPU medians
3.325 / 3.125 / 3.392 ms. Peak capture draw count 447, below the 512 gate.
No new shader programs after ready. These are stationary per-encounter device
measurements, separate from real-input verification.

The prior upgrade's ten-minute soak is historical evidence for that revision;
this follow-up uses the full gate, focused boundary/aim regressions and fresh
practice/mission input runs. No new ten-minute soak is claimed here.

This snapshot was subsequently published and merged in PR #1 as part of
`e687d7b`. No public deployment is recorded here.
