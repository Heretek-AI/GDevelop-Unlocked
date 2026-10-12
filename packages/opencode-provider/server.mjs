// OpenAI-compatible HTTP daemon (T08, issue #18): the local provider bridge
// Electron/axios clients talk to instead of a hosted model endpoint.
//
// Native `node:http` only, zero dependencies, zero egress (no hosted calls
// anywhere in this package). Endpoints:
//   GET  /v1/models             -> model list (CORS-enabled)
//   POST /v1/chat/completions   -> stream:false standard completion + usage,
//                                  stream:true SSE chunk deltas + data:[DONE]
//   OPTIONS *                   -> 204 permissive preflight for Electron/axios
//
// Function calling: an explicit `{"name": <one of the 39 editor functions>,
// "arguments": {...}}` message is mapped to an OpenAI `tool_calls` payload
// (see adapter.mjs); anything else gets a deterministic local echo. This is
// an offline bridge, not a model: without a backend it never invents tool
// arguments, it only normalizes explicit invocations.

import http from 'node:http';

import {
  EDITOR_FUNCTION_NAMES,
  isEditorFunctionName,
  parseFunctionCallMessage,
  mapFunctionCallToToolCall,
  openAiMessagesToSession,
  buildUsage,
  chunkTextForStream,
} from './adapter.mjs';

export const OPENAI_MODEL_ID = 'gdevelop-local';

/**
 * The 39 GDevelop editor function schemas served to OpenAI clients.
 * Distilled verbatim from upstream `GDEVELOP_OPENAI_TOOLS` in
 * `packages/ai-studio/AI/CustomAIClient.js` (descriptions + parameters);
 * the integration suite pins the names against that registry.
 */
export const EDITOR_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'create_scene',
      description:
        'Create a new scene in the GDevelop project with the given name.',
      parameters: {
        type: 'object',
        properties: {
          scene_name: {
            type: 'string',
            description: 'Name of the new scene to create.',
          },
        },
        required: ['scene_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_or_replace_object',
      description:
        'Create or replace an object in a scene (or global if scene_name is omitted).',
      parameters: {
        type: 'object',
        properties: {
          object_name: {
            type: 'string',
            description: 'Name of the object.',
          },
          object_type: {
            type: 'string',
            description:
              'Type of object (e.g. "Sprite", "TiledSpriteObject::TiledSprite", "TextObject::Text", "PanelSpriteObject::PanelSprite", "Tilemap::Tilemap", "Scene3D::Cube3D").',
          },
          scene_name: {
            type: 'string',
            description:
              'Name of the scene. If omitted or empty, creates a global object.',
          },
          description: {
            type: 'string',
            description: 'Optional description of the object purpose.',
          },
        },
        required: ['object_name', 'object_type'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_behavior',
      description: 'Add a behavior to an object in the project.',
      parameters: {
        type: 'object',
        properties: {
          object_name: {
            type: 'string',
            description: 'Name of the object to add behavior to.',
          },
          behavior_name: {
            type: 'string',
            description:
              'Unique name for this behavior instance on the object.',
          },
          behavior_type: {
            type: 'string',
            description:
              'Type of behavior (e.g. "PlatformBehavior::PlatformerObjectBehavior", "PlatformBehavior::PlatformBehavior", "TopDownMovementBehavior::TopDownMovementBehavior", "Physics2::Physics2Behavior", "DestroyOutsideBehavior::DestroyOutside", "SmoothCamera::SmoothCamera").',
          },
          scene_name: {
            type: 'string',
            description:
              'Name of the scene (if object is a scene object). Omit for global objects.',
          },
        },
        required: ['object_name', 'behavior_name', 'behavior_type'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'put_2d_instances',
      description:
        'Place one or more 2D instances of objects into a scene at specified coordinates.',
      parameters: {
        type: 'object',
        properties: {
          scene_name: {
            type: 'string',
            description: 'Name of the scene.',
          },
          instances: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                object_name: {
                  type: 'string',
                  description: 'Name of the object to instantiate.',
                },
                x: { type: 'number', description: 'X position in pixels.' },
                y: { type: 'number', description: 'Y position in pixels.' },
                layer_name: {
                  type: 'string',
                  description:
                    'Layer name (default empty string for base layer).',
                },
                angle: {
                  type: 'number',
                  description: 'Angle in degrees (default 0).',
                },
                z_order: { type: 'number', description: 'Z-order.' },
              },
              required: ['object_name', 'x', 'y'],
            },
            description: 'List of instances to place.',
          },
        },
        required: ['scene_name', 'instances'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_scene_events',
      description:
        'Generate or modify scene events in GDevelop based on natural language description.',
      parameters: {
        type: 'object',
        properties: {
          scene_name: {
            type: 'string',
            description: 'Name of the scene whose events are being modified.',
          },
          events_description: {
            type: 'string',
            description:
              'Detailed natural language description of the events logic to implement.',
          },
          objects_list: {
            type: 'string',
            description:
              'Comma-separated list of objects involved in these events.',
          },
          extension_names_list: {
            type: 'string',
            description:
              'Comma-separated list of extensions/behaviors used (e.g. "PlatformBehavior::PlatformerObjectBehavior, Keyboard, Scene").',
          },
        },
        required: ['scene_name', 'events_description'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_script',
      description:
        'Execute a JavaScript script in the GDevelop editor to inspect or modify the project. Inside the script, the editor functions are plain async functions in scope: call them with `await`, e.g. `await create_or_replace_object({...})` (a `functions` namespace alias with the same functions also exists). `console.log` lines and the return value are reported back. Nothing else is in scope: browser and engine globals (window, document, gd, fetch, localStorage) are shadowed or cannot reach the open project, so never probe for them - call an exposed function directly. A ReferenceError names the functions available in the script.',
      parameters: {
        type: 'object',
        properties: {
          js_code: {
            type: 'string',
            description:
              'JavaScript code to execute in the editor environment. Has access to exposed editor functions and project APIs.',
          },
          title: {
            type: 'string',
            description:
              'Short human-readable title for this script, shown in the chat.',
          },
          script: {
            type: 'string',
            description:
              'Deprecated alias for js_code. Prefer js_code; script is accepted for compatibility and mapped to js_code.',
          },
        },
        required: ['js_code'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_events_source',
      description:
        'Read the current events of a scene in EventScript source format.',
      parameters: {
        type: 'object',
        properties: {
          scene_name: {
            type: 'string',
            description: 'Name of the scene.',
          },
        },
        required: ['scene_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'describe_instances',
      description: 'List all instances present in a scene.',
      parameters: {
        type: 'object',
        properties: {
          scene_name: {
            type: 'string',
            description: 'Name of the scene.',
          },
          filter_by_object_name: {
            type: 'string',
            description:
              'Optional comma-separated list of object names to filter by.',
          },
        },
        required: ['scene_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'inspect_object_properties_effects',
      description: 'Inspect properties and effects of an object.',
      parameters: {
        type: 'object',
        properties: {
          object_name: { type: 'string', description: 'Name of the object.' },
          scene_name: {
            type: 'string',
            description: 'Scene name if scene object.',
          },
        },
        required: ['object_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'inspect_behavior_properties',
      description: 'Inspect properties of a behavior attached to an object.',
      parameters: {
        type: 'object',
        properties: {
          object_name: { type: 'string', description: 'Name of the object.' },
          behavior_name: {
            type: 'string',
            description: 'Name of the behavior instance.',
          },
          scene_name: {
            type: 'string',
            description: 'Scene name if scene object.',
          },
        },
        required: ['object_name', 'behavior_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'inspect_scene_properties_layers_effects',
      description: 'Inspect properties, layers, and effects of a scene.',
      parameters: {
        type: 'object',
        properties: {
          scene_name: { type: 'string', description: 'Name of the scene.' },
        },
        required: ['scene_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'change_scene_properties_layers_effects_groups',
      description:
        'Change properties of a scene (such as backgroundColor, resolution, name, firstScene), layers, effects, or object groups.',
      parameters: {
        type: 'object',
        properties: {
          scene_name: {
            type: 'string',
            description: 'Name of the scene.',
          },
          changed_properties: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                property_name: {
                  type: 'string',
                  description:
                    'Name of the scene property: "backgroundColor" (hex string like "#3498db" or "rgb(52, 152, 219)"), "gameResolutionWidth", "gameResolutionHeight", "name", "isFirstScene", "stopSoundsOnStartup", "gameOrientation", "gameScaleMode", "gameName".',
                },
                new_value: {
                  type: 'string',
                  description: 'The new value for the property as a string.',
                },
              },
              required: ['property_name', 'new_value'],
            },
            description: 'List of scene properties to update.',
          },
          changed_layers: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                layer_name: { type: 'string' },
                new_layer_name: { type: 'string' },
                is_lighting_layer: { type: 'boolean' },
                is_follow_base_layer_camera: { type: 'boolean' },
                delete_this_layer: { type: 'boolean' },
              },
              required: ['layer_name'],
            },
            description: 'List of layers to modify, create or remove.',
          },
          changed_layer_effects: {
            type: 'array',
            description:
              'Effects of a layer to add, update, rename, move or remove.',
            items: {
              type: 'object',
              properties: {
                layer_name: { type: 'string' },
                effect_name: { type: 'string' },
                effect_type: { type: 'string' },
                new_effect_name: { type: 'string' },
                new_effect_position: { type: 'number' },
                delete_this_effect: { type: 'boolean' },
                changed_properties: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      property_name: { type: 'string' },
                      new_value: { type: 'string' },
                    },
                    required: ['property_name', 'new_value'],
                  },
                },
              },
              required: ['layer_name', 'effect_name'],
            },
          },
          changed_groups: {
            type: 'array',
            description:
              'Object groups of the scene (or custom object) to create, rename, or change membership of.',
            items: {
              type: 'object',
              properties: {
                group_name: { type: 'string' },
                new_group_name: { type: 'string' },
                delete_this_group: { type: 'boolean' },
                objects_to_add: {
                  type: 'array',
                  items: { type: 'string' },
                },
                objects_to_remove: {
                  type: 'array',
                  items: { type: 'string' },
                },
              },
              required: ['group_name'],
            },
          },
          move_instances: {
            type: 'object',
            description:
              'Move instances of this scene to another scene or external layout, optionally filtered.',
            properties: {
              to_scope: {
                type: 'object',
                description:
                  'Target scope: { type: "scene", scene_name } or { type: "external_layout", external_layout_name }.',
              },
              filter_by_object_names: {
                type: 'array',
                items: { type: 'string' },
              },
              filter_by_layer_names: {
                type: 'array',
                items: { type: 'string' },
              },
              instance_ids: {
                type: 'array',
                items: { type: 'string' },
              },
            },
            required: ['to_scope'],
          },
          delete_this_scene: {
            type: 'boolean',
            description: 'Set to true to delete this scene.',
          },
        },
        required: ['scene_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'change_object_properties_effects',
      description: 'Change properties and visual effects of an object.',
      parameters: {
        type: 'object',
        properties: {
          object_name: { type: 'string', description: 'Name of the object.' },
          scene_name: {
            type: 'string',
            description: 'Name of the scene (omit for global object).',
          },
          changed_properties: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                property_name: { type: 'string' },
                new_value: { type: 'string' },
              },
              required: ['property_name', 'new_value'],
            },
          },
          changed_effects: {
            type: 'array',
            description:
              'Visual effects of the object to add, update, rename, move or remove.',
            items: {
              type: 'object',
              properties: {
                effect_name: { type: 'string' },
                effect_type: { type: 'string' },
                new_effect_name: { type: 'string' },
                new_effect_position: { type: 'number' },
                delete_this_effect: { type: 'boolean' },
                changed_properties: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      property_name: { type: 'string' },
                      new_value: { type: 'string' },
                    },
                    required: ['property_name', 'new_value'],
                  },
                },
              },
              required: ['effect_name'],
            },
          },
          delete_this_object: { type: 'boolean' },
        },
        required: ['object_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'change_behavior_property',
      description: 'Change a property of a behavior attached to an object.',
      parameters: {
        type: 'object',
        properties: {
          object_name: { type: 'string', description: 'Name of the object.' },
          behavior_name: {
            type: 'string',
            description: 'Name of the behavior instance.',
          },
          changed_properties: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                property_name: { type: 'string' },
                new_value: { type: 'string' },
              },
              required: ['property_name', 'new_value'],
            },
            description:
              'Behavior properties to set. Each item names a property and its new value as a string.',
          },
          scene_name: {
            type: 'string',
            description: 'Scene name if scene object.',
          },
          delete_this_behavior: {
            type: 'boolean',
            description: 'Set to true to remove this behavior.',
          },
        },
        required: ['object_name', 'behavior_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'change_project_properties_resources',
      description:
        'Change global project settings such as window resolution, orientation, scale mode, or game name.',
      parameters: {
        type: 'object',
        properties: {
          changed_properties: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                property_name: {
                  type: 'string',
                  description:
                    'Property name: "gameResolutionWidth", "gameResolutionHeight", "gameOrientation", "gameScaleMode", "gameName", "packageName", "version", "author", "loadingScreenBackgroundColor".',
                },
                new_value: { type: 'string' },
              },
              required: ['property_name', 'new_value'],
            },
            description: 'List of project properties to update.',
          },
          changed_resources: {
            type: 'array',
            description:
              'Project resources to rename or remove (e.g. an audio file).',
            items: {
              type: 'object',
              properties: {
                resource_name: { type: 'string' },
                new_resource_name: { type: 'string' },
                delete_this_resource: { type: 'boolean' },
              },
              required: ['resource_name'],
            },
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'inspect_project_properties_resources',
      description: 'Inspect project global properties and resources list.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_or_edit_variable',
      description: 'Add or edit a variable at project, scene, or object level.',
      parameters: {
        type: 'object',
        properties: {
          variable_scope: {
            type: 'string',
            enum: ['global', 'scene', 'object', 'group', 'instance'],
            description: 'Scope of the variable ("global", "scene", "object").',
          },
          scope: {
            type: 'string',
            enum: ['global', 'scene', 'object', 'group', 'instance'],
            description: 'Alias for variable_scope.',
          },
          variable_name_or_path: {
            type: 'string',
            description:
              'Variable name or path (e.g. "Score" or "Player.Health").',
          },
          name: {
            type: 'string',
            description: 'Alias for variable_name_or_path.',
          },
          variable_type: {
            type: 'string',
            enum: ['number', 'string', 'boolean', 'structure', 'array'],
            description: 'Variable type.',
          },
          type: {
            type: 'string',
            enum: ['number', 'string', 'boolean', 'structure', 'array'],
            description: 'Alias for variable_type.',
          },
          value: { description: 'Initial or updated value for the variable.' },
          scene_name: {
            type: 'string',
            description: 'Scene name if scope is scene or object.',
          },
          object_name: {
            type: 'string',
            description: 'Object name if scope is object.',
          },
          delete_this_variable: {
            type: 'boolean',
            description: 'Set to true to delete this variable.',
          },
          variables: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                variable_name_or_path: { type: 'string' },
                name: { type: 'string' },
                value: { type: 'string' },
                variable_type: { type: 'string' },
                type: { type: 'string' },
                delete_this_variable: { type: 'boolean' },
              },
            },
            description: 'Optional batch of variable operations.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'put_3d_instances',
      description:
        'Place 3D instances of objects into a scene at specified 3D coordinates.',
      parameters: {
        type: 'object',
        properties: {
          scene_name: { type: 'string', description: 'Name of the scene.' },
          object_name: {
            type: 'string',
            description: 'Name of the 3D object.',
          },
          layer_name: {
            type: 'string',
            description: 'Layer name (default "").',
          },
          brush_kind: {
            type: 'string',
            enum: ['create', 'erase', 'modify'],
            description: 'Action to perform.',
          },
          brush_position: {
            type: 'string',
            description: 'Position "x, y, z" in 3D space.',
          },
          new_instances_count: {
            type: 'number',
            description: 'Number of instances to create (default 1).',
          },
        },
        required: ['scene_name', 'layer_name', 'brush_kind'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'inspect_variables',
      description: 'Inspect variables at global, scene, or object level.',
      parameters: {
        type: 'object',
        properties: {
          variable_scope: {
            type: 'string',
            enum: ['global', 'scene', 'object'],
            description: 'Scope of the variables to inspect.',
          },
          scene_name: {
            type: 'string',
            description: 'Name of the scene (if scope is scene or object).',
          },
          object_name: {
            type: 'string',
            description: 'Name of the object (if scope is object).',
          },
          variable_names_or_paths: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Optional list of specific variable names or paths to inspect.',
          },
        },
        required: ['variable_scope'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_game_project_json',
      description: 'Read the complete or partial game project structure JSON.',
      parameters: {
        type: 'object',
        properties: {
          section: {
            type: 'string',
            description: 'Optional section of project JSON to inspect.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_object_asset_store',
      description:
        'Search the GDevelop asset store for 2D/3D objects and sprite packs.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search term (e.g. "player", "coin", "platform").',
          },
          category: { type: 'string', description: 'Optional asset category.' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_resource_store',
      description:
        'Search the GDevelop resource store for audio sounds, music, and fonts.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search term (e.g. "jump", "laser", "music").',
          },
          resource_kind: {
            type: 'string',
            enum: ['audio', 'font', 'image'],
            description: 'Kind of resource to search.',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_docs',
      description:
        'Search GDevelop documentation for functions, behaviors, and instructions. [Offline in local BYOK mode: rely on internal GDevelop knowledge and on-project verification]',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Documentation search query.' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_full_docs',
      description:
        'Read full documentation for specific GDevelop extensions or features. [Offline in local BYOK mode: rely on internal GDevelop knowledge and on-project verification]',
      parameters: {
        type: 'object',
        properties: {
          extension_names: {
            type: 'string',
            description:
              'Comma-separated names of extensions to read docs for.',
          },
        },
        required: ['extension_names'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'initialize_project',
      description: 'Initialize a new project from a starter template.',
      parameters: {
        type: 'object',
        properties: {
          project_name: {
            type: 'string',
            description: 'Name of the new project/game.',
          },
          game_name: { type: 'string', description: 'Alias for project_name.' },
          name: { type: 'string', description: 'Alias for project_name.' },
          template_slug: {
            type: 'string',
            description:
              'Slug of the starter template (e.g. "empty", "platformer", "top-down").',
          },
          also_read_existing_events: {
            type: 'boolean',
            description: 'Whether to read existing events from template.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_game_starter_summary',
      description:
        'Get a summary of an example starter template to study its structure.',
      parameters: {
        type: 'object',
        properties: {
          template_slug: {
            type: 'string',
            description: 'Slug of the starter template.',
          },
        },
        required: ['template_slug'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_or_update_plan',
      description: 'Create or update the step-by-step orchestrator plan.',
      parameters: {
        type: 'object',
        properties: {
          tasks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Task ID (e.g. "task_1").' },
                title: { type: 'string', description: 'Short task title.' },
                description: { type: 'string', description: 'Task details.' },
                status: {
                  type: 'string',
                  enum: ['pending', 'in_progress', 'done', 'voided'],
                  description: 'Task status.',
                },
                dependsOn: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'List of task IDs this task depends on.',
                },
              },
              required: ['id', 'title', 'description', 'status'],
            },
          },
        },
        required: ['tasks'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_gameplay_test',
      description:
        'Run or save a gameplay test in the project or an extension.',
      parameters: {
        type: 'object',
        properties: {
          scope: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['project', 'extension'] },
              extension_name: { type: 'string' },
            },
            required: ['type'],
            description:
              'Test scope ({ type: "project" } or { type: "extension", extension_name: "..." }).',
          },
          test_name: { type: 'string', description: 'Name of the test.' },
          source: {
            type: 'string',
            description: 'Optional test JavaScript code.',
          },
          persist: {
            type: 'boolean',
            description: 'Whether to save the test (default true).',
          },
          timeout_ms: {
            type: 'number',
            description: 'Timeout in milliseconds.',
          },
        },
        required: ['scope', 'test_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'change_gameplay_tests',
      description:
        'Change properties of or delete gameplay tests in the project.',
      parameters: {
        type: 'object',
        properties: {
          scope: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['project', 'extension'] },
              extension_name: { type: 'string' },
            },
            required: ['type'],
          },
          changes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                test_name: { type: 'string' },
                delete_this_test: { type: 'boolean' },
                changed_properties: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      property_name: { type: 'string' },
                      new_value: { type: 'string' },
                    },
                    required: ['property_name', 'new_value'],
                  },
                },
              },
              required: ['test_name'],
            },
          },
        },
        required: ['scope', 'changes'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_extension',
      description:
        'Create a new events-functions extension in the project. Optionally copy an existing one.',
      parameters: {
        type: 'object',
        properties: {
          extension_name: {
            type: 'string',
            description:
              'Name of the extension to create. It is made unique automatically if taken.',
          },
          duplicated_extension_name: {
            type: 'string',
            description:
              'Name of an existing extension to copy into the new one. Omit to create an empty extension.',
          },
          full_name: {
            type: 'string',
            description: 'Human-readable title shown in the editor.',
          },
          short_description: {
            type: 'string',
            description: 'One-line description of the extension.',
          },
          description: {
            type: 'string',
            description: 'Full description of the extension.',
          },
          category: { type: 'string', description: 'Extension category.' },
          tags: {
            type: 'string',
            description: 'Comma-separated tags.',
          },
          author: { type: 'string', description: 'Extension author.' },
        },
        required: ['extension_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'change_extension_properties',
      description:
        'Change properties of an extension, its dependencies, or delete the extension.',
      parameters: {
        type: 'object',
        properties: {
          extension_name: {
            type: 'string',
            description: 'Name of the extension to change.',
          },
          new_name: {
            type: 'string',
            description: 'New name for the extension, to rename it.',
          },
          delete_this_extension: {
            type: 'boolean',
            description: 'Set to true to delete the extension.',
          },
          delete_even_if_used: {
            type: 'boolean',
            description:
              'Allow deleting an extension that is still used. Only when delete_this_extension is true.',
          },
          changed_properties: {
            type: 'array',
            description: 'Properties to set on the extension.',
            items: {
              type: 'object',
              properties: {
                property_name: {
                  type: 'string',
                  description:
                    'One of: fullName, shortDescription, description, category, tags, version, author, helpPath, previewIconUrl, iconUrl, dimension.',
                },
                new_value: { type: 'string' },
              },
              required: ['property_name', 'new_value'],
            },
          },
          changed_dependencies: {
            type: 'array',
            description: 'Dependencies to create, edit or delete.',
            items: {
              type: 'object',
              properties: {
                dependency_name: { type: 'string' },
                dependency_type: { type: 'string' },
                new_name: { type: 'string' },
                export_name: { type: 'string' },
                version: { type: 'string' },
                delete_this_dependency: { type: 'boolean' },
                extra_settings: {
                  type: 'object',
                  description: 'Dependency-specific settings, as strings.',
                },
              },
              required: ['dependency_name'],
            },
          },
        },
        required: ['extension_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_custom_object',
      description:
        'Create a custom object (an events-based object) in an extension, optionally as a copy of an existing one.',
      parameters: {
        type: 'object',
        properties: {
          extension_name: {
            type: 'string',
            description: 'Extension to create the custom object in.',
          },
          custom_object_name: {
            type: 'string',
            description: 'Name of the new custom object.',
          },
          duplicated_custom_object_name: {
            type: 'string',
            description: 'Existing custom object to copy.',
          },
          duplicated_from_extension_name: {
            type: 'string',
            description:
              'Extension holding the custom object to copy. Defaults to extension_name.',
          },
          area: {
            type: 'object',
            description:
              'Default area of the object, as numbers: minX, minY, minZ, maxX, maxY, maxZ.',
            properties: {
              minX: { type: 'number' },
              minY: { type: 'number' },
              minZ: { type: 'number' },
              maxX: { type: 'number' },
              maxY: { type: 'number' },
              maxZ: { type: 'number' },
            },
          },
        },
        required: ['extension_name', 'custom_object_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'change_custom_object',
      description:
        'Change a custom object: rename, delete, change its settings, its variants or its properties.',
      parameters: {
        type: 'object',
        properties: {
          extension_name: {
            type: 'string',
            description: 'Extension holding the custom object.',
          },
          custom_object_name: {
            type: 'string',
            description: 'Name of the custom object to change.',
          },
          new_name: { type: 'string', description: 'New name, to rename it.' },
          delete_this_custom_object: {
            type: 'boolean',
            description: 'Set to true to delete the custom object.',
          },
          delete_even_if_used: {
            type: 'boolean',
            description:
              'Allow deleting a custom object that is still used. Only when delete_this_custom_object is true.',
          },
          fit_area_to_children: {
            type: 'string',
            description:
              'Whether to fit the area to the children (true/false).',
          },
          changed_settings: {
            type: 'array',
            description: 'Settings to change on the custom object.',
            items: {
              type: 'object',
              properties: {
                setting_name: { type: 'string' },
                new_value: {
                  description:
                    'String, boolean or number depending on the setting.',
                },
              },
              required: ['setting_name', 'new_value'],
            },
          },
          changed_variants: {
            type: 'array',
            description: 'Variants to create or delete.',
            items: {
              type: 'object',
              properties: {
                variant_name: { type: 'string' },
                duplicated_from_variant_name: { type: 'string' },
                delete_this_variant: { type: 'boolean' },
              },
              required: ['variant_name'],
            },
          },
          changed_properties: {
            type: 'array',
            description: 'Properties to set on the custom object.',
            items: {
              type: 'object',
              properties: {
                property_name: { type: 'string' },
                new_value: { type: 'string' },
              },
              required: ['property_name', 'new_value'],
            },
          },
        },
        required: ['extension_name', 'custom_object_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_custom_behavior',
      description:
        'Create a custom behavior (an events-based behavior) in an extension.',
      parameters: {
        type: 'object',
        properties: {
          extension_name: {
            type: 'string',
            description: 'Extension to create the behavior in.',
          },
          custom_behavior_name: {
            type: 'string',
            description: 'Name of the new custom behavior.',
          },
          duplicated_custom_behavior_name: {
            type: 'string',
            description: 'Existing custom behavior to copy.',
          },
          duplicated_from_extension_name: {
            type: 'string',
            description:
              'Extension holding the behavior to copy. Defaults to extension_name.',
          },
          full_name: {
            type: 'string',
            description: 'Human-readable title.',
          },
          description: { type: 'string' },
          object_type: {
            type: 'string',
            description:
              'Restrict the behavior to objects of this type. Omit for all objects.',
          },
        },
        required: ['extension_name', 'custom_behavior_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'change_custom_behavior',
      description:
        'Change a custom behavior: rename, delete, change its settings, its shared properties or its properties.',
      parameters: {
        type: 'object',
        properties: {
          extension_name: {
            type: 'string',
            description: 'Extension holding the custom behavior.',
          },
          custom_behavior_name: {
            type: 'string',
            description: 'Name of the custom behavior to change.',
          },
          new_name: { type: 'string', description: 'New name, to rename it.' },
          delete_this_custom_behavior: {
            type: 'boolean',
            description: 'Set to true to delete the custom behavior.',
          },
          delete_even_if_used: {
            type: 'boolean',
            description:
              'Allow deleting a behavior that is still used. Only when delete_this_custom_behavior is true.',
          },
          changed_settings: {
            type: 'array',
            description: 'Settings to change on the custom behavior.',
            items: {
              type: 'object',
              properties: {
                setting_name: { type: 'string' },
                new_value: {
                  description:
                    'String, boolean or number depending on the setting.',
                },
              },
              required: ['setting_name', 'new_value'],
            },
          },
          changed_shared_properties: {
            type: 'array',
            description: 'Shared properties of the behavior to change.',
            items: {
              type: 'object',
              properties: {
                property_name: { type: 'string' },
                new_value: { type: 'string' },
              },
              required: ['property_name', 'new_value'],
            },
          },
          changed_properties: {
            type: 'array',
            description: 'Properties of the behavior to change.',
            items: {
              type: 'object',
              properties: {
                property_name: { type: 'string' },
                new_value: { type: 'string' },
              },
              required: ['property_name', 'new_value'],
            },
          },
        },
        required: ['extension_name', 'custom_behavior_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_custom_function',
      description:
        'Create a function in an extension, a custom object or a custom behavior.',
      parameters: {
        type: 'object',
        properties: {
          scope: {
            type: 'object',
            description:
              'Where to create the function. type "extension" needs extension_name; "custom_object" needs extension_name and custom_object_name; "custom_behavior" needs extension_name and custom_behavior_name.',
            properties: {
              type: {
                type: 'string',
                enum: ['extension', 'custom_object', 'custom_behavior'],
              },
              extension_name: { type: 'string' },
              custom_object_name: { type: 'string' },
              custom_behavior_name: { type: 'string' },
            },
            required: ['type'],
          },
          function_name: {
            type: 'string',
            description: 'Name of the new function.',
          },
          duplicated_function_name: {
            type: 'string',
            description: 'Existing function to copy.',
          },
          function_type: {
            type: 'string',
            description:
              'Action, Condition, Expression, StringExpression or ActionWithOperator.',
          },
          getter_name: {
            type: 'string',
            description:
              'For ActionWithOperator: the getter function to build from.',
          },
          full_name: { type: 'string' },
          description: { type: 'string' },
          group: { type: 'string' },
          sentence: {
            type: 'string',
            description: 'Sentence shown in the events sheet.',
          },
          parameters: {
            type: 'array',
            description: 'Parameters to declare on the function.',
            items: { type: 'object' },
          },
        },
        required: ['scope', 'function_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'change_custom_function',
      description:
        'Change a function: rename, delete, change its settings or its parameters.',
      parameters: {
        type: 'object',
        properties: {
          scope: {
            type: 'object',
            description:
              'Where the function lives. type "extension" needs extension_name; "custom_object" needs extension_name and custom_object_name; "custom_behavior" needs extension_name and custom_behavior_name.',
            properties: {
              type: {
                type: 'string',
                enum: ['extension', 'custom_object', 'custom_behavior'],
              },
              extension_name: { type: 'string' },
              custom_object_name: { type: 'string' },
              custom_behavior_name: { type: 'string' },
            },
            required: ['type'],
          },
          function_name: {
            type: 'string',
            description: 'Name of the function to change.',
          },
          new_name: { type: 'string', description: 'New name, to rename it.' },
          delete_this_function: {
            type: 'boolean',
            description: 'Set to true to delete the function.',
          },
          changed_settings: {
            type: 'array',
            description: 'Settings to change on the function.',
            items: {
              type: 'object',
              properties: {
                setting_name: { type: 'string' },
                new_value: {
                  description:
                    'String, boolean or number depending on the setting.',
                },
              },
              required: ['setting_name', 'new_value'],
            },
          },
          changed_parameters: {
            type: 'array',
            description: 'Parameters to change on the function.',
            items: { type: 'object' },
          },
        },
        required: ['scope', 'function_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'inspect_extension',
      description:
        'Read the structure of an extension: its custom objects, custom behaviors, functions and variants.',
      parameters: {
        type: 'object',
        properties: {
          extension_name: {
            type: 'string',
            description: 'Name of the extension to inspect.',
          },
          custom_object_name: {
            type: 'string',
            description: 'Restrict the output to this custom object.',
          },
          custom_behavior_name: {
            type: 'string',
            description: 'Restrict the output to this custom behavior.',
          },
          function_name: {
            type: 'string',
            description: 'Restrict the output to this function.',
          },
          variant_name: {
            type: 'string',
            description: 'Restrict the output to this variant.',
          },
        },
        required: ['extension_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'spawn_agent',
      description:
        'Delegate one task to a studio sub-agent, which works on it and reports back. Only the studio lead may call this. Sub-agents never delegate further.',
      parameters: {
        type: 'object',
        properties: {
          role: {
            type: 'string',
            description:
              'Which specialist to use: "designer" writes the design document as GDD_ project variables; "developer" changes the project to implement a task; "tester" writes and runs a gameplay test and reports pass or fail.',
            enum: ['designer', 'developer', 'tester'],
          },
          short_title: {
            type: 'string',
            description:
              'A 2-5 word label shown in the chat for this sub-agent, e.g. "Build the town grid".',
          },
          task: {
            type: 'string',
            description:
              'The complete, self-contained instruction for the sub-agent. It cannot see this conversation, so state everything it needs: the scene, the objects, the expected result.',
          },
          context: {
            type: 'string',
            description:
              'Extra facts the sub-agent needs: relevant variable values, previous findings, constraints.',
          },
          related_task_id: {
            type: 'string',
            description:
              'The id of the create_or_update_plan task this agent works on. That task is marked done when the agent reports back.',
          },
        },
        required: ['role', 'short_title', 'task'],
      },
    },
  },
];

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, authorization',
  'Access-Control-Max-Age': '86400',
};

const MAX_BODY_BYTES = 1024 * 1024;

const errorPayload = (message, code = 'invalid_request_error') => ({
  error: { message, type: 'invalid_request_error', code },
});

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    ...CORS_HEADERS,
  });
  res.end(body);
}

function validateTools(tools) {
  if (tools === undefined) return;
  if (!Array.isArray(tools)) {
    throw new Error('`tools` must be an array');
  }
  for (const tool of tools) {
    if (
      !tool ||
      tool.type !== 'function' ||
      !tool.function ||
      typeof tool.function.name !== 'string' ||
      tool.function.name.length === 0
    ) {
      throw new Error('every `tools` entry must be {type:"function",function:{name,...}}');
    }
  }
}

function validateToolChoice(toolChoice) {
  if (toolChoice === undefined || toolChoice === null) return;
  if (typeof toolChoice === 'string') {
    if (!['none', 'auto', 'required'].includes(toolChoice)) {
      throw new Error('`tool_choice` string must be none|auto|required');
    }
    return;
  }
  if (
    typeof toolChoice !== 'object' ||
    toolChoice.type !== 'function' ||
    !toolChoice.function ||
    typeof toolChoice.function.name !== 'string'
  ) {
    throw new Error('`tool_choice` object must be {type:"function",function:{name}}');
  }
  if (!isEditorFunctionName(toolChoice.function.name)) {
    throw new Error(`unknown function "${toolChoice.function.name}" in \`tool_choice\``);
  }
}

/** Find the last explicit function-call message, oldest-last scan. */
function findFunctionCall(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message || typeof message.content !== 'string') continue;
    const call = parseFunctionCallMessage(message.content);
    if (call) return call;
  }
  return null;
}

function buildEchoContent(session) {
  const userTexts = session.prompt
    .split('\n')
    .filter(line => !line.startsWith('['))
    .join('\n')
    .trim();
  const last = userTexts.slice(-200);
  const count = session.prompt.split('\n').length;
  return last.length > 0
    ? `[${OPENAI_MODEL_ID}] echo (${count} prompt line(s)): ${last}`
    : `[${OPENAI_MODEL_ID}] echo: empty prompt`;
}

function writeSseResponse(res, { model, sessionId, content, toolCalls }) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    ...CORS_HEADERS,
  });
  let alive = true;
  res.on('close', () => {
    alive = false;
  });
  const frame = payload => alive && res.write(`data: ${JSON.stringify(payload)}\n\n`);
  const created = Math.floor(Date.now() / 1000);
  const base = { id: sessionId, object: 'chat.completion.chunk', created, model };
  frame({ ...base, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] });
  if (toolCalls && toolCalls.length > 0) {
    // Stream each call as name + arguments deltas (arguments may ride in
    // several chunks for large payloads, mirroring hosted providers).
    toolCalls.forEach((call, index) => {
      frame({
        ...base,
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                { index, id: call.id, type: 'function', function: { name: call.function.name, arguments: '' } },
              ],
            },
            finish_reason: null,
          },
        ],
      });
      for (const piece of chunkTextForStream(call.function.arguments, 64)) {
        frame({
          ...base,
          choices: [
            {
              index: 0,
              delta: { tool_calls: [{ index, function: { arguments: piece } }] },
              finish_reason: null,
            },
          ],
        });
      }
    });
    frame({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] });
  } else {
    for (const piece of chunkTextForStream(content)) {
      frame({ ...base, choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] });
    }
    frame({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
  }
  if (alive) res.write('data: [DONE]\n\n');
  res.end();
}

function handleChatCompletions(req, res, { model }) {
  let received = 0;
  let oversized = false;
  const pieces = [];
  req.on('data', chunk => {
    received += chunk.length;
    if (received > MAX_BODY_BYTES) {
      // Stop accumulating (memory-safe) but keep draining so the client
      // receives a proper 413 instead of a connection reset.
      oversized = true;
      return;
    }
    pieces.push(chunk);
  });
  req.on('end', () => {
    if (oversized) {
      sendJson(res, 413, errorPayload('request body exceeds 1MB'));
      return;
    }
    let body;
    try {
      body = JSON.parse(Buffer.concat(pieces).toString('utf8') || 'null');
    } catch {
      sendJson(res, 400, errorPayload('request body is not valid JSON'));
      return;
    }
    try {
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new Error('request body must be a JSON object');
      }
      const { messages, tools, tool_choice, stream } = body;
      validateTools(tools);
      validateToolChoice(tool_choice);
      const session = openAiMessagesToSession(messages, {});
      const sessionId = `chatcmpl-${session.id.replace(/^sess_/, '')}`;
      const functionCall = findFunctionCall(messages);
      const toolCalls = functionCall
        ? [mapFunctionCallToToolCall(functionCall)]
        : [];
      const content = buildEchoContent(session);
      const usage = buildUsage(
        session.prompt,
        toolCalls.length > 0 ? toolCalls[0].function.arguments : content
      );
      if (stream === true) {
        writeSseResponse(res, { model, sessionId, content, toolCalls });
        return;
      }
      const finish_reason = toolCalls.length > 0 ? 'tool_calls' : 'stop';
      sendJson(res, 200, {
        id: sessionId,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: toolCalls.length > 0 ? null : content,
              ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
            },
            finish_reason,
          },
        ],
        usage,
      });
    } catch (err) {
      sendJson(res, 400, errorPayload(err.message));
    }
  });
  req.on('error', () => {
    try {
      sendJson(res, 400, errorPayload('request read failed'));
    } catch {}
  });
}

export function createRequestHandler({ model = OPENAI_MODEL_ID } = {}) {
  return (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }
    if (url.pathname === '/v1/models') {
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: { message: 'method not allowed', type: 'invalid_request_error', code: 'method_not_allowed' } });
        return;
      }
      sendJson(res, 200, {
        object: 'list',
        data: [{ id: model, object: 'model', owned_by: 'gdevelop-local' }],
      });
      return;
    }
    if (url.pathname === '/v1/chat/completions') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: { message: 'method not allowed', type: 'invalid_request_error', code: 'method_not_allowed' } });
        return;
      }
      handleChatCompletions(req, res, { model });
      return;
    }
    sendJson(res, 404, {
      error: { message: `not found: ${url.pathname}`, type: 'invalid_request_error', code: 'not_found' },
    });
  };
}

/**
 * Boot the daemon. `port: 0` binds an ephemeral loopback port (discover via
 * `handle.address().port`). Resolves to `{ address(), close() }`.
 */
export function startServer({ host = '127.0.0.1', port = 0, model = OPENAI_MODEL_ID } = {}) {
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 0 || port > 65535) {
    return Promise.reject(new RangeError(`[opencode-provider] invalid port (${String(port)})`));
  }
  return new Promise((resolve, reject) => {
    const server = http.createServer(createRequestHandler({ model }));
    server.once('error', reject);
    server.listen(port, host, () => {
      resolve({
        address: () => server.address(),
        close: () =>
          new Promise(closeResolve => {
            server.close(() => closeResolve());
          }),
      });
    });
  });
}
