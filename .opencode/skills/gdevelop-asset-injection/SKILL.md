---
name: gdevelop-asset-injection
description: Injects, registers, and embeds assets (images, audio, fonts, 3D models, tilemaps) into GDevelop 5 projects. Handles AssetStoreContext public catalog resolution, Resource descriptors, animation frames, collision masks, and asset bundling.
license: Apache-2.0
compatibility: opencode
metadata:
  opencode/slash: "true"
  opencode/autoinvoke: "false"
---

# GDevelop Asset Injection Skill

Manages resource descriptors, local asset embeddings, public asset catalog queries via `AssetStoreContext`, and sprite animation structures in GDevelop 5 games.

## Protocol Phase 1: Resource Storage Architecture
1. In GDevelop projects (`game.json` or split folder):
   - Resources reside in `resources.resources[]`.
   - Each resource has:
     - `name`: Identifier used by objects and events (e.g. `Hero_Idle.png`, `JumpSound.wav`).
     - `file`: Path relative to the project root directory (e.g. `assets/sprites/Hero_Idle.png`).
     - `kind`: Resource type (`image`, `audio`, `font`, `video`, `json`, `tilemap`, `tileset`, `bitmapFont`, `model3D`, `atlas`, `spine`, `javascript`).
     - `userAdded`: `true` for project-specific custom files.
     - `metadata`: Optional metadata or URL.
     - `origin`: Origin information (`originName`, `originIdentifier`).
2. Objects never reference raw system disk paths directly; they reference the registered `resource.name`.

## Protocol Phase 2: Sprite Object & Animation Injection
1. A `Sprite` object configuration contains `animations[]`:
   - Each animation has:
     - `name`: e.g. `Idle`, `Run`, `Jump`, `Attack`.
     - `useMultipleDirections`: `false` (standard 2D platformer) or `true` (top-down 8-directional).
     - `directions[]`:
       - `timeBetweenFrames`: Frame duration in seconds (e.g. `0.08` for 12.5 FPS).
       - `looping`: `true` or `false`.
       - `sprites[]`:
         - `image`: The exact name of the registered `image` resource.
         - `points[]`: Anchor and origin points (`{ name: "Origin", x: 0, y: 0 }`, `{ name: "Centre", x: 16, y: 16 }`).
         - `hasCustomCollisionMask`: `false` (default bounding box) or `true` with custom vertices.

## Protocol Phase 3: Audio & Font Resource Injection
1. **Audio**:
   - Supported runtime formats: `.wav`, `.mp3`, `.ogg`, `.aac`.
   - In events: played via `PlaySound` or `PlayMusic` using the resource name.
2. **Fonts**:
   - Supported formats: `.ttf`, `.otf`, `.woff`, `.woff2`.
   - Referenced by `TextObject::Text` objects.
3. **3D Models**:
   - Supported formats: `.glb`, `.gltf`.
   - Referenced by `Scene3D::Model3DObject`.

## Protocol Phase 4: Public Catalog & AssetStoreContext Resolution
1. In GDevelop-Unlocked BYOK mode:
   - Asset store queries route through public asset registries and local catalogs without hosted paywall tokens.
   - Resource files are downloaded or copied into `<project_dir>/assets/<kind>/`.
   - Resource entries are atomically appended to `project.resources.resources`.

## Protocol Phase 5: Validation & Gate
1. Validate against `./schemas/asset-injection.schema.json`.
2. Ensure every file referenced actually exists relative to project root.
3. Validate animation frame names and collision polygons.
