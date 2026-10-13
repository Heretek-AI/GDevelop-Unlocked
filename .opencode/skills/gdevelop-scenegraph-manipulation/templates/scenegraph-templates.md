# Scene Graph Configuration Templates

## 1. Multi-Layer Setup with Lighting & UI

This layout pattern configures a 2D scene with a background gameplay layer, a dynamic lighting layer with ambient tinting, and an untracked HUD layer.

```json
{
  "scene_name": "Level1",
  "changed_layers": [
    {
      "layer_name": "Base layer",
      "is_lighting_layer": false,
      "is_follow_base_layer_camera": true
    },
    {
      "layer_name": "LightingLayer",
      "is_lighting_layer": true,
      "is_follow_base_layer_camera": true
    },
    {
      "layer_name": "HUD",
      "is_lighting_layer": false,
      "is_follow_base_layer_camera": false
    }
  ],
  "changed_layer_effects": [
    {
      "layer_name": "LightingLayer",
      "effect_name": "AmbientColor",
      "effect_type": "Lighting::Ambient",
      "changed_properties": [
        { "property_name": "color", "new_value": "#181828" }
      ]
    }
  ]
}
```

## 2. 2D & 3D Instance Population Template

```json
{
  "scene_name": "Level1",
  "instances": [
    {
      "object_name": "Player",
      "x": 128,
      "y": 480,
      "layer_name": "Base layer",
      "angle": 0,
      "z_order": 10
    },
    {
      "object_name": "TorchLight",
      "x": 300,
      "y": 450,
      "layer_name": "LightingLayer",
      "angle": 0,
      "z_order": 5
    },
    {
      "object_name": "HealthText",
      "x": 20,
      "y": 20,
      "layer_name": "HUD",
      "angle": 0,
      "z_order": 100
    }
  ]
}
```

## 3. 3D Camera & Mesh Setup Template

```json
{
  "layer_name": "3DWorld",
  "renderingType": "3d",
  "camera3DNearPlaneDistance": 0.1,
  "camera3DFarPlaneDistance": 5000,
  "camera3DFieldOfView": 60,
  "followBaseLayerCamera": true
}
```
