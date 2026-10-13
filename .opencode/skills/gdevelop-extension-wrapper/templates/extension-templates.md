# Extension Wrapper Templates & Lifecycle Reference

## 1. CustomBehavior Lifecycle Specification

When implementing a custom behavior in GDevelop (`EventsBasedBehavior`), lifecycle methods must use exact canonical names:

| Lifecycle Function | Execution Point | Signature / Parameters |
|---|---|---|
| `onCreated` | When behavior instance is initialized on runtime object | `_PARAM0_: Object`, `_PARAM1_: Behavior` |
| `doStepPreEvents` | Stepped once per frame BEFORE scene events run | `_PARAM0_: Object`, `_PARAM1_: Behavior` |
| `doStepPostEvents` | Stepped once per frame AFTER scene events run | `_PARAM0_: Object`, `_PARAM1_: Behavior` |
| `onDestroy` | When owner object is removed from scene | `_PARAM0_: Object`, `_PARAM1_: Behavior` |
| `onActivate` | When behavior is switched from inactive to active | `_PARAM0_: Object`, `_PARAM1_: Behavior` |
| `onDeActivate` | When behavior is deactivated | `_PARAM0_: Object`, `_PARAM1_: Behavior` |

### Lifecycle Behavior Template (JS Implementation)
```javascript
// Function: doStepPreEvents
// Scope: custom_behavior
{
  "name": "doStepPreEvents",
  "fullName": "Step Pre Events",
  "description": "Internal step method",
  "functionType": "Action",
  "isPrivate": true,
  "parameters": [
    { "name": "Object", "type": "object", "description": "The object" },
    { "name": "Behavior", "type": "behavior", "description": "The behavior" }
  ],
  "useJsCode": true,
  "jsCode": `
    const obj = eventsFunctionContext.getObjects("Object")[0];
    const behavior = eventsFunctionContext.getBehavior("Behavior");
    // Retrieve internal property
    const speed = behavior._speed || 100;
    // Step logic
    if (obj) {
      obj.setX(obj.getX() + speed * (runtimeScene.getTimeManager().getElapsedTime() / 1000));
    }
  `
}
```

## 2. CustomObject Template
A CustomObject combines child objects into an encapsulated composite object with internal layout, behaviors, and actions.

```json
{
  "name": "HealthBar",
  "fullName": "Floating Health Bar",
  "description": "Composite health bar with background and dynamic fill bar",
  "defaultName": "HealthBar",
  "isRenderedIn3D": false,
  "area": { "minX": 0, "minY": 0, "minZ": 0, "maxX": 100, "maxY": 10, "maxZ": 0 },
  "objects": [
    { "name": "Background", "type": "PanelSpriteObject::PanelSprite" },
    { "name": "Fill", "type": "PanelSpriteObject::PanelSprite" }
  ],
  "properties": [
    { "name": "MaxHealth", "type": "Number", "value": 100 },
    { "name": "CurrentHealth", "type": "Number", "value": 100 }
  ]
}
```
