# Solved build and verification issues

- 2026-09-07 — Hardware Chrome capture reported a console 404 despite successful model loads → Chrome requests a favicon automatically → declare an empty data favicon in index.html; preserve strict console-error capture.
- 2026-09-07 — Perf passed a fast paused scene and software renderers → CPU render submission was treated as device performance without simulation liveness → require hardware renderer identity, valid GPU timer samples, active fixed-tick advancement, rAF frame pacing, and demonstrated failing fixtures. Warm up before sampling; report CPU and GPU separately.

- 2026-09-07 — Final fail-open lint found asset export could silently lose bevel detail → modifier exceptions were swallowed → raise a contextual error with the original cause and exercise successful and intentionally failed modifier application in Blender. Bound the test subprocess so a hung exporter cannot hang the gate.

- 2026-09-07 — Blender printed an uncaught Python export traceback but npm reported success → Blender defaults to exit zero for Python exceptions → pass `--python-exit-code 1` before the script and verify a real injected exception exits nonzero.
- 2026-09-07 — Blender regression aborted at USD platform initialization inside the restricted sandbox, before Python executed → native Blender startup requires the approved execution context used by the full gate → rerun the same bounded regression with sandbox escalation; it passes without changing the test or assets.

- 2026-09-07 — Crosshair shifted away from the rendered view after panel resize → resize handler reused canvas client dimensions after assigning fixed CSS pixels, while HUD followed viewport → resize from window dimensions; real-input practice regression fails on the old behavior and checks hip/ADS alignment across three aspect ratios.

- 2026-09-07 — Practice probe intermittently missed FOV End input or read the crosshair as hidden immediately after Resume → session state, pointer unlock and HUD presentation settle at different times → wait for actual pointer release, click the visible slider before targeted key input, and wait for the resumed HUD frame; retain bounded state/value assertions so ignored controls still fail.
