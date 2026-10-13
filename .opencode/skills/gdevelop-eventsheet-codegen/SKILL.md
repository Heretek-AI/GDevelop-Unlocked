---
name: gdevelop-eventsheet-codegen
description: Deterministic code generation and validation for GDevelop 5 Event Sheets. Generates condition/action expression trees, handles standard, while, repeat, for-each, link, and JS code events with sub-event hierarchies.
license: Apache-2.0
compatibility: opencode
metadata:
  opencode/slash: "true"
  opencode/autoinvoke: "false"
---

# GDevelop Event Sheet Codegen Skill

Generates, edits, and validates GDevelop 5 Event Sheets (conditions, actions, and sub-event trees) ensuring 100% schema compliance with GDevelop Core AST serialization.

## Protocol Phase 1: Context Hydration
1. Query `codebase-memory-mcp` for relevant instruction metadata:
   - For conditions/actions: query `gd::InstructionMetadata` or check `reference/instruction-types.json`.
2. Inspect target layout or external events file via `gdevelop_project_read`.
3. Check existing variable scope: layout variables (`layout.variables`), global variables (`project.variables`), or object variables.

## Protocol Phase 2: Expression Tree Construction
1. **Conditions (`conditions[]`)**:
   - Every condition requires `type` (e.g. `DepartScene`, `KeyPressed`, `CollisionNP`).
   - Inverted condition: set `inverted: true` (or `type.inverted: true`).
   - Boolean composites:
     - `BuiltinCommonInstructions::And` with nested `subInstructions`.
     - `BuiltinCommonInstructions::Or` with nested `subInstructions`.
     - `BuiltinCommonInstructions::Not` with nested `subInstructions`.
     - `BuiltinCommonInstructions::Once` for trigger-once-while-true.
   - Expressions in parameters MUST be strictly formatted without unescaped quotes.
2. **Actions (`actions[]`)**:
   - Every action requires `type` (e.g. `MettreX`, `MettreY`, `AddForceXY`, `ChangeColor`).
   - Async actions: set `await: true` when waiting for completion.
   - Parameters must match exact signature order expected by GDCore `InstructionMetadata`.
3. **Sub-events (`events[]`)**:
   - Construct child events recursively under parent events.
   - Sub-events only evaluate when parent conditions are satisfied.
4. **Special Event Types**:
   - `BuiltinCommonInstructions::While`: Requires `whileConditions[]`, `conditions[]`, `actions[]`, `events[]`.
   - `BuiltinCommonInstructions::Repeat`: Requires `repeatExpression` (string), `conditions[]`, `actions[]`, `events[]`.
   - `BuiltinCommonInstructions::ForEach`: Requires `object` (string), `conditions[]`, `actions[]`, `events[]`.
   - `BuiltinCommonInstructions::JsCode`: Requires `inlineCode` (string), `parameterObjects` (comma-separated string).
   - `BuiltinCommonInstructions::Comment`: Requires `comment` (string).
   - `BuiltinCommonInstructions::Link`: Requires `target` (string name of external event or layout).

## Protocol Phase 3: Validation & Gate
1. Validate generated AST against `./schemas/eventsheet.schema.json`.
2. Run Semgrep validation rule `gdevelop-eventsheet-ast-check` to verify no malformed parameter types or missing await flags.
3. Commit mutation via `gdevelop_project_add_events` or `packages/unlock-shim/control-shim.mjs`.
