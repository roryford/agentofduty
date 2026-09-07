# Source artwork

`textures/` contains the albedo and roughness inputs embedded by the Blender
exporter into `public/models/*.glb`. `concepts/` preserves the original rifle and
enemy reference images; they are not exporter inputs. These files were moved
unchanged from `public/models/textures/` to avoid shipping build-time artwork.

The runtime facade texture remains in `public/models/textures/`. Run `npm run
assets` to rebuild hero meshes with Blender. Source images originate from the
July Imagine art pass; see the historical pipeline notes in `docs/LESSONS.md`.
