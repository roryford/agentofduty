# Optional follow-ups (not blocking wrap)

Prioritized ideas if work continues. None of these are required for the current gate.

## High value

1. ~~**Viewmodel polish**~~ — done: dark-green glove, hip/ADS, FOV, spread, **holo optic + reticle**, coord docs.
2. ~~**Enemy LODs / silhouettes**~~ — LO blobs removed; **always full mesh** (user prefer).
3. **True AO / contact shadows** — quality bar still lists them; expensive — only if budget allows.
4. ~~**Audio mix**~~ — done (distance, surface impacts, enemy rate-limit + quieter).
5. ~~**Metrics honesty**~~ — done (`drawCallsWorld` / `drawCallsView` / total).

## Medium

6. **More Imagine material maps** — normal maps (not just albedo/roughness) baked into GLBs.
7. **Street variety** — alley spur, prop scatter seed table, fewer repeated dumpster yaws.
8. **Damage feedback** — directional damage vignette, hit direction indicator.
9. **Save baselines in CI** — gate job: build + assets cache + capture + diff + perf.

## Low / later

10. Expand beyond one archetype or one weapon (only after the quality bar still holds).
11. Mobile / touch controls.
12. Daylight variant (explicitly out of brief unless brief changes).

## Non-goals (unless brief changes)

- Daylight primary look
- Many weapons / multiplayer
- New runtime npm dependencies beyond `three`
