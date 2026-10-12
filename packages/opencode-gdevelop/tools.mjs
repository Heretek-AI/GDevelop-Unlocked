// GDevelop OpenCode tool definitions (T09, issue #17): six host-registered
// tools for local GDevelop 5 project control.
//
// Every project mutation delegates to
// packages/unlock-shim/control-shim.mjs — this module performs no direct
// project file writes of its own by design).
// Inputs are plain JSON-Schema objects (the host Tool.ValueSchema union
// accepts JsonSchema.JsonSchema), so this package stays zero-dependency and
// loadable without the host `@opencode/plugin` runtime installed.
// Each `execute` returns a host-shaped `{ output, content }` result.

import {
  readGDevelopProject,
  writeGDevelopProject,
  createScene,
  createOrReplaceObject,
  addBehavior,
  addStandardEvent,
  buildGDevelopCliCommand,
} from '../unlock-shim/control-shim.mjs';

const projectPathProp = {
  type: 'string',
  description: 'Path to game.json or to a split-folder project directory.',
};
const sceneNameProp = {
  type: 'string',
  description: 'Scene (layout) name.',
};

const objectSchemaOf = scene => {
  const summary = {
    name: scene.name,
    objects: (scene.objects || []).map(entry => entry && entry.name),
    objectCount: (scene.objects || []).length,
    eventCount: (scene.events || []).length,
    variables: (scene.variables || []).map(entry => entry && entry.name),
  };
  const objects = {};
  for (const entry of scene.objects || []) {
    if (!entry || typeof entry.name !== 'string') continue;
    objects[entry.name] = {
      type: entry.type,
      behaviors: (entry.behaviors || []).map(b => b && b.name),
      variables: (entry.variables || []).map(v => v && v.name),
    };
  }
  if (scene) summary.objectsByName = objects;
  return summary;
};

async function executeProjectRead(input) {
  const project = readGDevelopProject(input.projectPath);
  const scenes = (project.layouts || []).map(objectSchemaOf);
  if (input.sceneName !== undefined && input.sceneName !== null && String(input.sceneName).length > 0) {
    const scene = scenes.find(entry => entry.name === input.sceneName);
    if (!scene) {
      throw new Error(`[opencode-gdevelop] project_read: scene not found: "${input.sceneName}"`);
    }
    return {
      output: { projectName: project.properties.name, scene },
      content: `Scene "${scene.name}": ${scene.objectCount} object(s), ${scene.eventCount} event(s).`,
    };
  }
  return {
    output: {
      projectName: project.properties.name,
      scenes,
      globalObjects: (project.objects || []).map(entry => entry && entry.name),
    },
    content: `Project "${project.properties.name}": ${scenes.length} scene(s): ${scenes.map(s => s.name).join(', ') || '(none)'}.`,
  };
}

async function executeCreateScene(input) {
  const project = readGDevelopProject(input.projectPath);
  createScene(project, input.sceneName);
  writeGDevelopProject(input.projectPath, project);
  return {
    output: { sceneName: input.sceneName, created: true },
    content: `Scene "${input.sceneName}" created in ${input.projectPath}.`,
  };
}

async function executeCreateObject(input) {
  const project = readGDevelopProject(input.projectPath);
  const { object, created } = createOrReplaceObject(project, {
    sceneName: input.sceneName,
    objectName: input.objectName,
    objectType: input.objectType,
    description: input.description,
  });
  writeGDevelopProject(input.projectPath, project);
  return {
    output: {
      objectName: object.name,
      objectType: object.type,
      sceneName: input.sceneName || null,
      created,
    },
    content: `Object "${object.name}" (${object.type}) ${created ? 'created' : 'replaced'}${input.sceneName ? ` in scene "${input.sceneName}"` : ' globally'}.`,
  };
}

async function executeAddBehavior(input) {
  const project = readGDevelopProject(input.projectPath);
  const behavior = addBehavior(project, {
    sceneName: input.sceneName,
    objectName: input.objectName,
    behaviorName: input.behaviorName,
    behaviorType: input.behaviorType,
  });
  writeGDevelopProject(input.projectPath, project);
  return {
    output: {
      objectName: input.objectName,
      behaviorName: behavior.name,
      behaviorType: behavior.type,
    },
    content: `Behavior "${behavior.name}" (${behavior.type}) added to "${input.objectName}".`,
  };
}

async function executeAddEvents(input) {
  const project = readGDevelopProject(input.projectPath);
  const event = addStandardEvent(project, {
    sceneName: input.sceneName,
    conditions: input.conditions,
    actions: input.actions,
  });
  writeGDevelopProject(input.projectPath, project);
  const scene = project.layouts.find(layout => layout && layout.name === input.sceneName);
  return {
    output: {
      sceneName: input.sceneName,
      eventType: event.type,
      eventIndex: scene.events.indexOf(event),
      conditionCount: event.conditions.length,
      actionCount: event.actions.length,
    },
    content: `Standard event appended to scene "${input.sceneName}" (${event.conditions.length} condition(s), ${event.actions.length} action(s)).`,
  };
}

async function executeCliRun(input) {
  const formatted = buildGDevelopCliCommand({
    gdevelopPath: input.gdevelopPath,
    projectPath: input.projectPath,
    commandName: input.commandName,
    cmdArgs: input.cmdArgs,
    headless: input.headless,
  });
  return {
    output: formatted,
    content: [formatted.command, ...formatted.args].join(' '),
  };
}

/** The six host-registered tool definitions, in registration order. */
export const GDEVELOP_TOOLS = [
  {
    name: 'gdevelop_project_read',
    description:
      'Inspect a GDevelop project on disk: scenes, objects, behaviors, and variables.',
    input: {
      type: 'object',
      properties: {
        projectPath: projectPathProp,
        sceneName: {
          ...sceneNameProp,
          description: 'Optional: restrict the report to one scene.',
        },
      },
      required: ['projectPath'],
      additionalProperties: false,
    },
    execute: executeProjectRead,
  },
  {
    name: 'gdevelop_project_create_scene',
    description: 'Create a new scene (layout) in a GDevelop project on disk.',
    input: {
      type: 'object',
      properties: { projectPath: projectPathProp, sceneName: sceneNameProp },
      required: ['projectPath', 'sceneName'],
      additionalProperties: false,
    },
    execute: executeCreateScene,
  },
  {
    name: 'gdevelop_project_create_object',
    description:
      'Create (or replace) an object — Sprite, TextObject::Text, PanelSpriteObject::PanelSprite, Scene3D::* or any engine type — in a scene or globally.',
    input: {
      type: 'object',
      properties: {
        projectPath: projectPathProp,
        sceneName: {
          ...sceneNameProp,
          description: 'Optional: target scene; omit for a global object.',
        },
        objectName: { type: 'string', description: 'New object name.' },
        objectType: {
          type: 'string',
          description:
            'Engine object type (Sprite, TextObject::Text, PanelSpriteObject::PanelSprite, Scene3D::Box3DObject, …).',
        },
        description: { type: 'string', description: 'Optional object description.' },
      },
      required: ['projectPath', 'objectName', 'objectType'],
      additionalProperties: false,
    },
    execute: executeCreateObject,
  },
  {
    name: 'gdevelop_project_add_behavior',
    description:
      'Attach a behavior (e.g. PlatformBehavior::PlatformerObjectBehavior) to an object.',
    input: {
      type: 'object',
      properties: {
        projectPath: projectPathProp,
        sceneName: {
          ...sceneNameProp,
          description: 'Optional: scene holding the object; omit for global objects.',
        },
        objectName: { type: 'string', description: 'Target object name.' },
        behaviorName: { type: 'string', description: 'Behavior instance name.' },
        behaviorType: {
          type: 'string',
          description: 'Fully qualified behavior type.',
        },
      },
      required: ['projectPath', 'objectName', 'behaviorName', 'behaviorType'],
      additionalProperties: false,
    },
    execute: executeAddBehavior,
  },
  {
    name: 'gdevelop_project_add_events',
    description:
      'Append a BuiltinCommonInstructions::Standard event (conditions/actions) to a scene event sheet.',
    input: {
      type: 'object',
      properties: {
        projectPath: projectPathProp,
        sceneName: sceneNameProp,
        conditions: {
          type: 'array',
          description: 'Condition entries (default []).',
        },
        actions: { type: 'array', description: 'Action entries (default []).' },
      },
      required: ['projectPath', 'sceneName'],
      additionalProperties: false,
    },
    execute: executeAddEvents,
  },
  {
    name: 'gdevelop_cli_run',
    description:
      'Format a headless GDevelop CLI dispatch (--run-command NAME --cmd-args …) for the host to spawn.',
    input: {
      type: 'object',
      properties: {
        gdevelopPath: { type: 'string', description: 'GDevelop binary path.' },
        projectPath: { type: 'string', description: 'Project path (positional CLI arg).' },
        commandName: {
          type: 'string',
          description: 'UPPER_SNAKE_CASE command name.',
        },
        cmdArgs: {
          type: 'array',
          description: 'Repeatable --cmd-args values.',
          items: { type: 'string' },
        },
        headless: {
          type: 'boolean',
          description: 'Add --disable-update-check for CI/headless runs.',
        },
      },
      required: ['gdevelopPath', 'projectPath', 'commandName'],
      additionalProperties: false,
    },
    execute: executeCliRun,
  },
];

/** Registration-order tool names. */
export const TOOL_NAMES = GDEVELOP_TOOLS.map(tool => tool.name);
