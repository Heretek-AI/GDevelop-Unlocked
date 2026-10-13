---
name: gdevelop-extension-wrapper
description: Wraps custom logic, behaviors, and object types into modular GDevelop 5 Extensions (EventsFunctionExtension). Bridges C++ libGDevelop runtime objects with JavaScript bindings, CustomBehavior, and CustomObject definitions.
license: Apache-2.0
compatibility: opencode
metadata:
  opencode/slash: "true"
  opencode/autoinvoke: "false"
---

# GDevelop Extension Wrapper Skill

Constructs, inspects, and modifies GDevelop 5 extensions (`EventsFunctionsExtension`), custom behaviors (`EventsBasedBehavior`), custom objects (`EventsBasedObject`), and custom functions.

## Protocol Phase 1: Upstream C++ / JS Bridge Architecture
1. In GDevelop Core / libGDevelop:
   - `gd::EventsFunctionsExtension` owns `EventsFunctionsContainer`, `EventsBasedBehaviorsList`, and `EventsBasedObjectsList`.
   - `gd::EventsBasedBehavior` inherits from `gd::AbstractEventsBasedEntity`. It declares properties, shared properties, and functions.
   - `gd::EventsBasedObject` inherits from `gd::AbstractEventsBasedEntity`. It manages child objects, initial instances, variants, and bounding boxes (`areaMinX`, `areaMinY`, etc.).
   - `gd::EventsFunction` defines an Action, Condition, Expression, StringExpression, or ActionWithOperator. It can be implemented via Event Sheets or via inline JavaScript.
2. In the WebAssembly bridge (`global.gd` / `GDevelop.js`):
   - Access functions through `gd.EventsFunctionsExtension`, `gd.asEventsBasedBehavior`, etc.

## Protocol Phase 2: Extension Composition
1. **Extension Manifest**:
   - `name`: Alphanumeric unique identifier (e.g. `HealthSystem`, `InventoryManager`).
   - `fullName`: Display title in editor.
   - `shortDescription`, `description`, `author`, `version`, `category`, `tags`.
2. **Custom Behaviors (`EventsBasedBehavior`)**:
   - Declare properties (`type: "Number" | "String" | "Boolean" | "Choice"`).
   - Wire standard lifecycle functions:
     - `onCreated`: Initialized when behavior is attached to runtime object.
     - `doStepPreEvents`: Called every frame BEFORE scene events run.
     - `doStepPostEvents`: Called every frame AFTER scene events run.
     - `onDestroy`: Cleanup when object is destroyed.
     - `onActivate` / `onDeActivate`: Toggling behavior active state.
3. **Custom Objects (`EventsBasedObject`)**:
   - Define child object templates in `objects[]`.
   - Define layout coordinates and layers in `initialInstances[]`.
   - Configure variants in `variants[]` for theme or style swaps.
   - Set 3D rendering flag (`markAsRenderedIn3D`) if containing 3D meshes.
4. **Custom Functions & Action/Condition Wrapping**:
   - Function type: `Action`, `Condition`, `Expression`, `StringExpression`.
   - Sentence template: e.g. `Set health of _PARAM0_ to _PARAM1_`.
   - Parameter descriptors:
     - Parameter 0 for behaviors: `type: "object"`, then `type: "behavior"`.
     - Value parameters: `type: "expression"` (number), `type: "string"` (text), `type: "boolean"`.

## Protocol Phase 3: Validation & Gate
1. Validate against `./schemas/extension.schema.json`.
2. Ensure lifecycle methods use exact names recognized by GDJS runtime code generator.
3. Validate with Semgrep rule `gdevelop-extension-schema-check`.
