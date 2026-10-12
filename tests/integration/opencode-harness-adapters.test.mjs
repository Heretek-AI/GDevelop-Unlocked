// Integration tests for harness adapters across OpenAI, Anthropic, MCP, and OpenCode.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  GDEVELOP_TOOLS,
  toOpenAiTool,
  toAnthropicTool,
  toMcpTool,
  toOpenCodeTool,
  exportAllTools,
} from '../../packages/opencode-gdevelop/tools.mjs';

describe('integration: harness-agnostic tool adapters', () => {
  it('converts tools to OpenAI function calling format', () => {
    const openaiTools = exportAllTools('openai');
    assert.equal(openaiTools.length, 6);
    for (const tool of openaiTools) {
      assert.equal(tool.type, 'function');
      assert.ok(tool.function.name.startsWith('gdevelop_'));
      assert.ok(tool.function.description);
      assert.equal(tool.function.parameters.type, 'object');
      assert.ok(Array.isArray(tool.function.parameters.required));
    }
  });

  it('converts tools to Anthropic tool use format', () => {
    const anthropicTools = exportAllTools('anthropic');
    assert.equal(anthropicTools.length, 6);
    for (const tool of anthropicTools) {
      assert.ok(tool.name.startsWith('gdevelop_'));
      assert.ok(tool.description);
      assert.equal(tool.input_schema.type, 'object');
      assert.ok(Array.isArray(tool.input_schema.required));
    }
  });

  it('converts tools to MCP format', () => {
    const mcpTools = exportAllTools('mcp');
    assert.equal(mcpTools.length, 6);
    for (const tool of mcpTools) {
      assert.ok(tool.name.startsWith('gdevelop_'));
      assert.ok(tool.description);
      assert.equal(tool.inputSchema.type, 'object');
      assert.ok(Array.isArray(tool.inputSchema.required));
    }
  });

  it('converts tools to OpenCode format with execute method preserved', () => {
    const openCodeTools = exportAllTools('opencode');
    assert.equal(openCodeTools.length, 6);
    for (const tool of openCodeTools) {
      assert.ok(tool.name.startsWith('gdevelop_'));
      assert.ok(tool.description);
      assert.equal(typeof tool.execute, 'function');
      assert.equal(tool.input.type, 'object');
    }
  });

  it('fails closed on unsupported format names', () => {
    assert.throws(() => exportAllTools('unsupported_format'), /unsupported tool format/);
  });
});
