# Verification and visual evidence

## Current workflow

Run `npm run gate` for the full behavioral suite, production build, mission
scenarios, native practice controls, fresh visual capture plus diff, and hardware
performance checks. Install dependencies, Chrome and Blender as described in the
README. Run this on a quiet machine for meaningful hardware frame timing.

`npm run build` records the source and output hashes in
`dist/evidence-build.json`. `npm run visual` captures and compares; it rejects a
build if runtime source, tooling, package metadata, or shipped assets changed.
`npm run capture` generates evidence without accepting new baselines.

Each capture attempt first invalidates `captures/manifest.json`. Images are
written to a fresh `captures/runs/run-*/` directory. Only a fully successful run
publishes a complete manifest. Each manifest records source revision and dirty
state, source/build hashes, time, browser, renderer, dimensions, seed, shot
definitions and image hashes. `index.html` in that run is the review gallery.
Failed and previous runs are retained for diagnosis; they are ignored by diff.
The generated `captures/` and `dist/` directories remain untracked.

Standalone `npm run diff` verifies provenance against the current source/build
and compares the entire declared shot set. It does not re-run capture. It may
reuse a successful run only while the source/build hashes still match. Missing,
altered or incomplete evidence fails. Git revision is contextual metadata;
content hashes identify the rendered input even while edits are uncommitted.

## Baseline review

The fourteen September Nightfall baselines supersede the three July prototype
images. They cover mission areas, hip fire, ADS, reload, damage/death, menus,
practice and victory. `tools/shots.json` declares staging and HUD inclusion.
These are explicitly staged views; behavioral tests and real input verify play.
The current lock predates capture provenance and is historical reference data,
not a claim of a fresh run. Never update it just to turn a failing gate green.

For intentional visual changes, run `npm run build && npm run capture`, inspect
every image in the gallery, and then copy approved images to their flat baseline
names and the manifest to `baselines/manifest.json`:

```bash
node --input-type=module -e "import fs from 'node:fs'; const m=JSON.parse(fs.readFileSync('captures/manifest.json')); if(m.status!=='complete')throw Error('Incomplete capture'); for(const s of m.shots)fs.copyFileSync('captures/'+s.file,'baselines/'+s.name+'.png'); fs.copyFileSync('captures/manifest.json','baselines/manifest.json');"
npm run gate
```

Keep the full declared baseline set; additions/removals require reviewing both
the shot manifest and baseline files. A browser/GPU change may change pixels;
record and inspect that difference before accepting a new lock.

## Evidence boundaries

`tools/practice.mjs` exercises native inputs across three aspect ratios.
`npm run play -- --seconds 600` adds a ten-minute stability soak, and
`node tools/route.mjs` completes an automated mission route. These are separate
from the staged visual gallery. Real-device performance records CPU, GPU and
display timing and rejects software renderers and stalled simulation.

Human recoil comfort, mission pacing, first-time navigation and the audio mix
remain open playtest items in `FOLLOWUPS.md`. Historical verification is in
`UPGRADE_REPORT.md` and `PRACTICE_FIXES.md`; it should not be presented as a new run.
