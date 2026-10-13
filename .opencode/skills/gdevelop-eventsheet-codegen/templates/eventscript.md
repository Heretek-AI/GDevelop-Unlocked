# EventScript DSL Templates & Syntax Specification

GDevelop EventScript is the authoritative line-oriented domain specific language used for bidirectional translation between textual LLM prompts and AST event representations.

## Grammar Reference

### 1. Standard Event
```eventscript
if <condition_expr>:
  <action_call_1>
  <action_call_2>
  # Nested Sub-events
  if <sub_condition>:
    <sub_action>
```

When no condition is present (runs unconditionally every frame):
```eventscript
always:
  <action_call>
```

### 2. Control Flow Events
#### While Loop
```eventscript
while <while_conditions> [index <var_name>] [if <conditions>]:
  <actions>
```

#### Repeat Loop
```eventscript
repeat <count_expression> times [index <var_name>] [if <conditions>]:
  <actions>
```

#### For-Each Object Iteration
```eventscript
for each <ObjectName> [order by <expr> asc|desc] [limit <N>] [index <var_name>] [if <conditions>]:
  <actions>
```

#### For-Each Child Variable
```eventscript
for each child in <VariableName> [value <val_var>] [key <key_var>] [index <var_name>] [if <conditions>]:
  <actions>
```

### 3. Special Event Forms
#### Inline JavaScript Block
```eventscript
js(<Object1>, <Object2>) """
const runtimeScene = runtimeScene;
const objects = eventsFunctionContext ? eventsFunctionContext.getObjects("Player") : runtimeScene.getObjects("Player");
for (const obj of objects) {
  obj.setX(obj.getX() + 5);
}
"""
```

#### Group Event
```eventscript
group "Player Controller":
  # events in group
```

#### Comment & Link
```eventscript
comment "Check for player death and trigger reload"
link "ExternalEventsSheet"
```

### 4. Expressions & Condition Operators
- Condition invocation: `ConditionName(arg1, arg2, ...)`
- Inverted condition: `not ConditionName(arg1, arg2, ...)`
- Trigger once: `once` / `not once`
- Conjunction: `(cond1 and cond2)`
- Disjunction: `Or(cond1, cond2)`
- Negation: `Not(cond1)`
- Action invocation: `ActionName(arg1, arg2, ...)`
- Async action: `await ActionName(arg1, arg2, ...)`

## Prompt Template for LLM Generation

```markdown
SYSTEM CONTEXT:
You are generating GDevelop 5 Event Sheets. You must output valid GDevelop AST JSON or valid EventScript DSL adhering to GDevelop Core conventions.

CONSTRAINTS:
1. Always specify exact condition and action identifiers (e.g. `DepartScene` for scene start, `KeyPressed` for input, `AddForceXY` for movement).
2. Quotes around string literals must be escaped in parameters (`"\"Player\""` or `Player`).
3. For movement in platformers, prefer invoking behavior methods (`PlatformerObject::SimulateLeftKey`) over manually modifying X/Y.
4. Keep action order deterministic: reads must precede writes.
5. All sub-events must be placed in the `events` array of their parent event.
```
