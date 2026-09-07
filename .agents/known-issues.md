# Solved build and verification issues

- 2026-09-07 — Hardware Chrome capture reported a console 404 despite successful model loads → Chrome requests a favicon automatically → declare an empty data favicon in index.html; preserve strict console-error capture.
- 2026-09-07 — Perf passed a fast paused scene and software renderers → CPU render submission was treated as device performance without simulation liveness → require hardware renderer identity, valid GPU timer samples, active fixed-tick advancement, rAF frame pacing, and demonstrated failing fixtures. Warm up before sampling; report CPU and GPU separately.
