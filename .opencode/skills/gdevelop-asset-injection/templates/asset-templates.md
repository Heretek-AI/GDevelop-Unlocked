# Asset Injection & Sprite Animation Templates

## 1. Full Resource Declaration Template

Add to `project.resources.resources`:

```json
[
  {
    "name": "hero_idle_0.png",
    "kind": "image",
    "file": "assets/sprites/hero/idle_0.png",
    "userAdded": true
  },
  {
    "name": "hero_run_0.png",
    "kind": "image",
    "file": "assets/sprites/hero/run_0.png",
    "userAdded": true
  },
  {
    "name": "hero_run_1.png",
    "kind": "image",
    "file": "assets/sprites/hero/run_1.png",
    "userAdded": true
  },
  {
    "name": "jump.wav",
    "kind": "audio",
    "file": "assets/audio/sfx/jump.wav",
    "userAdded": true
  },
  {
    "name": "PixelFont.ttf",
    "kind": "font",
    "file": "assets/fonts/PixelFont.ttf",
    "userAdded": true
  }
]
```

## 2. Animated Sprite Object Configuration Template

Embedded into `project.layouts[...].objects[...]` or `project.objects[...]`:

```json
{
  "name": "Hero",
  "type": "Sprite",
  "variables": [],
  "effects": [],
  "behaviors": [
    {
      "name": "PlatformerObject",
      "type": "PlatformBehavior::PlatformerObjectBehavior",
      "canGrabPlatforms": false,
      "maxSpeed": 250,
      "acceleration": 1500,
      "deceleration": 1500,
      "gravity": 1500,
      "jumpSpeed": 600
    }
  ],
  "animations": [
    {
      "name": "Idle",
      "useMultipleDirections": false,
      "directions": [
        {
          "looping": true,
          "timeBetweenFrames": 0.1,
          "sprites": [
            {
              "hasCustomCollisionMask": false,
              "image": "hero_idle_0.png",
              "points": [
                { "name": "Origin", "x": 0, "y": 0 },
                { "name": "Centre", "x": 16, "y": 16 }
              ]
            }
          ]
        }
      ]
    },
    {
      "name": "Run",
      "useMultipleDirections": false,
      "directions": [
        {
          "looping": true,
          "timeBetweenFrames": 0.08,
          "sprites": [
            {
              "hasCustomCollisionMask": false,
              "image": "hero_run_0.png",
              "points": [
                { "name": "Origin", "x": 0, "y": 0 },
                { "name": "Centre", "x": 16, "y": 16 }
              ]
            },
            {
              "hasCustomCollisionMask": false,
              "image": "hero_run_1.png",
              "points": [
                { "name": "Origin", "x": 0, "y": 0 },
                { "name": "Centre", "x": 16, "y": 16 }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```
