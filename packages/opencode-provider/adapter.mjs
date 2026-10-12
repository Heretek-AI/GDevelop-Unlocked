// Adapter (T08, issue #18): OpenAI <-> OpenCode session/prompt translation
// for the opencode provider daemon.
//
// Pure zero-dependency ESM: no I/O, no network. `server.mjs` owns the HTTP
// surface and the full 39-tool registry (`EDITOR_TOOLS`); this module owns
// the names (kept in step with upstream `GDEVELOP_OPENAI_TOOLS` by the
// integration suite), the function-call <-> tool_calls mapping, and the
// message <-> session translation both directions use.

import crypto from 'node:crypto';

/**
 * The 39 GDevelop editor functions the daemon can express as OpenAI
 * `tool_calls`. Frozen; the integration suite pins this list against the
 * upstream `CustomAIClient.js` registry, so rename/remove only alongside it.
 */
export const EDITOR_FUNCTION_NAMES = Object.freeze([
  'create_scene',
  'create_or_replace_object',
  'add_behavior',
  'put_2d_instances',
  'add_scene_events',
  'run_script',
  'read_events_source',
  'describe_instances',
  'inspect_object_properties_effects',
  'inspect_behavior_properties',
  'inspect_scene_properties_layers_effects',
  'change_scene_properties_layers_effects_groups',
  'change_object_properties_effects',
  'change_behavior_property',
  'change_project_properties_resources',
  'inspect_project_properties_resources',
  'add_or_edit_variable',
  'put_3d_instances',
  'inspect_variables',
  'read_game_project_json',
  'search_object_asset_store',
  'search_resource_store',
  'search_docs',
  'read_full_docs',
  'initialize_project',
  'get_game_starter_summary',
  'create_or_update_plan',
  'run_gameplay_test',
  'change_gameplay_tests',
  'create_extension',
  'change_extension_properties',
  'create_custom_object',
  'change_custom_object',
  'create_custom_behavior',
  'change_custom_behavior',
  'create_custom_function',
  'change_custom_function',
  'inspect_extension',
  'spawn_agent',
]);

/** True when `name` is one of the 39 editor functions. */
export function isEditorFunctionName(name) {
  return typeof name === 'string' && EDITOR_FUNCTION_NAMES.includes(name);
}

const randomCallId = () => `call_${crypto.randomBytes(9).toString('hex')}`;

/**
 * Parse an explicit function-call message (`{"name": ..., "arguments": ...}`,
 * arguments as object or JSON string). Returns `{ name, args }` or `null`
 * when the text is not a function-call message. Throws on a well-formed
 * call naming an unknown function (fail-closed: never emit tool_calls for
 * functions outside the 39).
 */
export function parseFunctionCallMessage(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return null;
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  if (typeof parsed.name !== 'string') return null;
  if (!isEditorFunctionName(parsed.name)) {
    throw new Error(
      `[opencode-provider] unknown function "${parsed.name}": not one of the 39 editor functions`
    );
  }
  let args = parsed.arguments === undefined ? {} : parsed.arguments;
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args);
    } catch {
      throw new Error(
        `[opencode-provider] function "${parsed.name}" has non-JSON arguments`
      );
    }
  }
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw new Error(
      `[opencode-provider] function "${parsed.name}" arguments must be a JSON object`
    );
  }
  return { name: parsed.name, args };
}

/**
 * Map one validated function call to an OpenAI `tool_calls` entry.
 * `args` may be an object or a JSON string; it is always serialized.
 */
export function mapFunctionCallToToolCall({ name, args, id } = {}) {
  if (!isEditorFunctionName(name)) {
    throw new Error(
      `[opencode-provider] unknown function "${String(name)}": not one of the 39 editor functions`
    );
  }
  const input = args === undefined ? {} : args;
  const normalized = typeof input === 'string' ? input : JSON.stringify(input);
  if (typeof input === 'string') JSON.parse(normalized); // fail-closed on bad JSON
  if (typeof input === 'object' && (input === null || Array.isArray(input))) {
    throw new Error(`[opencode-provider] function "${name}" arguments must be a JSON object`);
  }
  return {
    id: id || randomCallId(),
    type: 'function',
    function: { name, arguments: normalized },
  };
}

/** Map an OpenAI `tool_calls` entry to an OpenCode session step. */
export function toolCallToSessionStep(toolCall) {
  if (!toolCall || toolCall.type !== 'function' || !toolCall.function) {
    throw new Error('[opencode-provider] malformed tool_call entry');
  }
  const { name, arguments: argsJson } = toolCall.function;
  if (!isEditorFunctionName(name)) {
    throw new Error(`[opencode-provider] unknown function "${String(name)}" in tool_call`);
  }
  let input = {};
  if (argsJson !== undefined && argsJson !== '') {
    input = JSON.parse(argsJson);
  }
  return { type: 'tool_call', id: toolCall.id || randomCallId(), name, input };
}

/**
 * Translate an OpenAI `messages` list into an OpenCode session:
 * `{ id, prompt, steps }`. System messages seed the prompt context, the
 * user texts form the prompt, assistant `tool_calls` become `tool_call`
 * steps, and `tool` messages become `tool_result` steps.
 */
export function openAiMessagesToSession(messages, { sessionId } = {}) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('[opencode-provider] messages must be a non-empty array');
  }
  const promptParts = [];
  const steps = [];
  for (const message of messages) {
    if (!message || typeof message.role !== 'string') {
      throw new Error('[opencode-provider] every message needs a string role');
    }
    const content =
      typeof message.content === 'string'
        ? message.content
        : message.content == null
          ? ''
          : JSON.stringify(message.content);
    switch (message.role) {
      case 'system':
        promptParts.unshift(`[system] ${content}`);
        break;
      case 'user':
        promptParts.push(content);
        break;
      case 'assistant':
        if (content) promptParts.push(`[assistant] ${content}`);
        for (const toolCall of message.tool_calls || []) {
          steps.push(toolCallToSessionStep(toolCall));
        }
        break;
      case 'tool':
        steps.push({
          type: 'tool_result',
          toolCallId: message.tool_call_id || null,
          output: content,
        });
        break;
      default:
        promptParts.push(`[${message.role}] ${content}`);
        break;
    }
  }
  return {
    id: sessionId || `sess_${crypto.randomBytes(8).toString('hex')}`,
    prompt: promptParts.join('\n'),
    steps,
  };
}

/**
 * Translate session steps back into OpenAI messages (assistant `tool_calls`
 * plus `tool` results), e.g. when resuming a session as conversation history.
 */
export function sessionStepsToOpenAiMessages(steps) {
  const messages = [];
  for (const step of steps || []) {
    if (!step || typeof step !== 'object') continue;
    if (step.type === 'tool_call' && isEditorFunctionName(step.name)) {
      messages.push({
        role: 'assistant',
        content: null,
        tool_calls: [mapFunctionCallToToolCall({ name: step.name, args: step.input || {}, id: step.id })],
      });
    } else if (step.type === 'tool_result') {
      messages.push({
        role: 'tool',
        tool_call_id: step.toolCallId,
        content: typeof step.output === 'string' ? step.output : JSON.stringify(step.output ?? null),
      });
    }
  }
  return messages;
}

/**
 * Rough token estimate (chars/4 ASCII, 1 per non-ASCII unit) — good enough
 * for local usage meters, never a billing figure.
 */
export function estimateTokens(text) {
  if (!text || typeof text !== 'string') return 0;
  let ascii = 0;
  let nonAscii = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 0x7f) nonAscii += 1;
    else ascii += 1;
  }
  return Math.ceil(ascii / 4) + nonAscii;
}

/** Usage meter for a prompt/completion pair. */
export function buildUsage(promptText, completionText) {
  const prompt_tokens = estimateTokens(promptText);
  const completion_tokens = estimateTokens(completionText);
  return { prompt_tokens, completion_tokens, total_tokens: prompt_tokens + completion_tokens };
}

/** Split text into word-boundary chunks for SSE delta streaming. */
export function chunkTextForStream(text, maxChunk = 24) {
  const chunks = [];
  let current = '';
  for (const word of String(text).split(/(\s+)/)) {
    if ((current + word).length > maxChunk && current.length > 0) {
      chunks.push(current);
      current = '';
    }
    current += word;
  }
  if (current.length > 0) chunks.push(current);
  return chunks.length > 0 ? chunks : [''];
}
