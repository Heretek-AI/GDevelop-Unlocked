---
name: gdevelop-scenegraph-manipulation
description: Manipulates GDevelop 5 Scene Graph hierarchies, layers (2D, 3D, and lighting layers), 2D and 3D object instances, camera viewports, and lighting configurations.
license: Apache-2.0
compatibility: opencode
metadata:
  opencode/slash: "true"
  opencode/autoinvoke: "false"
---

# GDevelop Scene Graph Manipulation Skill

Handles declarative scene graph layout, multi-layer rendering, camera viewport routing, 2D/3D instance instantiation, and dynamic scene lighting.

## Protocol Phase 1: Scene & Layer Architecture
1. **Layer Hierarchy**:
   - `Base layer`: Mandatory base 2D/3D surface.
   - UI layers: Typically rendered above gameplay layers without camera parallax or zoom (`followBaseLayerCamera: false`).
   - Lighting layers (`isLightingLayer: true`): Renders 2D lighting passes and ambient shadows.
   - 3D layers (`renderingType: "3d"`): Renders WebGL/Three.js 3D meshes with depth buffering.
2. **Cameras**:
   - Each layer contains one or more `Camera` viewports (`x1`, `y1`, `x2`, `y2`).
   - Camera 3D properties: `camera3DNearPlaneDistance`, `camera3DFarPlaneDistance`, `camera3DFieldOfView` (FOV).

## Protocol Phase 2: Instance Placement (2D & 3D)
1. **2D Instances (`put_2d_instances`)**:
   - Target scene: `scene_name`.
   - Layer target: `layer_name` (defaults to `""` for Base layer).
   - Coordinates: `x`, `y` (floats in world pixels).
   - Rotation: `angle` (in degrees).
   - Z-order: `z_order` (controls draw sorting within layer).
2. **3D Instances (`put_3d_instances`)**:
   - Target scene and layer.
   - Position: `x, y, z` coordinates in 3D world space.
   - Rotations: `rotationX`, `rotationY`, `rotationZ`.
   - Dimensions: `width`, `height`, `depth`.
3. **Instance Variables & Overrides**:
   - Instances can override default object variables and initial property descriptors.

## Protocol Phase 3: Lighting & Visual Effects
1. **2D Lighting**:
   - Designate a layer as `is_lighting_layer: true`.
   - Place `Lighting::Light` objects on the scene.
   - Objects with `LightObstacleBehavior` cast real-time shadows onto the lighting layer.
2. **3D Lighting**:
   - Directional light: sun/moon illumination.
   - Point light: local lanterns, torches, or explosions.
   - Ambient light: global base illuminance.
3. **Layer Post-Processing Effects**:
   - Add PixiJS / Three.js filters (`Outline`, `Glow`, `ColorAdjust`, `Sepia`, `Bloom`).

## Protocol Phase 4: Validation & Gate
1. Validate against `./schemas/scenegraph.schema.json`.
2. Ensure instance object names exist in either the scene or global objects table.
3. Validate layers and camera bounds.
