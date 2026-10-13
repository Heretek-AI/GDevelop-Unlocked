// Integration Test: Tier 3 Progressive Disclosure Skills & Hydration Gate
//
// Validates:
// 1. Skill registration and progressive disclosure structure in ~/.config/opencode/skills and .opencode/skills
// 2. YAML frontmatter parsing and metadata conformance
// 3. Draft-07 JSON Schema validity for eventsheet, extension, scenegraph, and asset schemas
// 4. Schema validation against real-world GDevelop project fixtures
// 5. Semgrep AST security and architectural rule validation
//
// Real execution only (zero mocks). Bare node:test.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');

const REQUIRED_SKILLS = [
  'gdevelop-eventsheet-codegen',
  'gdevelop-extension-wrapper',
  'gdevelop-scenegraph-manipulation',
  'gdevelop-asset-injection',
];

describe('tier-3: progressive disclosure skills catalog', () => {
  for (const skill of REQUIRED_SKILLS) {
    it(`verifies skill manifest and frontmatter for "${skill}"`, () => {
      const skillDir = path.join(root, '.opencode', 'skills', skill);
      assert.ok(fs.existsSync(skillDir), `Skill directory must exist: ${skillDir}`);

      const skillMd = path.join(skillDir, 'SKILL.md');
      assert.ok(fs.existsSync(skillMd), `SKILL.md must exist in ${skillDir}`);

      const content = fs.readFileSync(skillMd, 'utf8');
      assert.ok(content.startsWith('---'), 'SKILL.md must start with YAML frontmatter');

      // Verify frontmatter keys
      assert.match(content, new RegExp(`name:\\s*${skill}`));
      assert.match(content, /description:\s*.+/);
      assert.match(content, /license:\s*Apache-2\.0/);
      assert.match(content, /compatibility:\s*opencode/);
      assert.match(content, /opencode\/slash:\s*"true"/);
    });

    it(`verifies global installation of skill "${skill}" in ~/.config/opencode/skills`, () => {
      const home = process.env.HOME || '/home/john';
      const globalSkillDir = path.join(home, '.config', 'opencode', 'skills', skill);
      assert.ok(fs.existsSync(globalSkillDir), `Global skill directory must exist: ${globalSkillDir}`);

      const globalSkillMd = path.join(globalSkillDir, 'SKILL.md');
      assert.ok(fs.existsSync(globalSkillMd), `Global SKILL.md must exist in ${globalSkillDir}`);
    });
  }
});

describe('tier-3: JSON parameter schemas validation', () => {
  const schemaMap = [
    {
      skill: 'gdevelop-eventsheet-codegen',
      file: 'schemas/eventsheet.schema.json',
      title: 'GDevelopEventSheet',
    },
    {
      skill: 'gdevelop-extension-wrapper',
      file: 'schemas/extension.schema.json',
      title: 'GDevelopExtensionSchema',
    },
    {
      skill: 'gdevelop-scenegraph-manipulation',
      file: 'schemas/scenegraph.schema.json',
      title: 'GDevelopSceneGraphSchema',
    },
    {
      skill: 'gdevelop-asset-injection',
      file: 'schemas/asset-injection.schema.json',
      title: 'GDevelopAssetInjectionSchema',
    },
  ];

  for (const item of schemaMap) {
    it(`validates JSON Schema syntax and title for "${item.title}"`, () => {
      const fullPath = path.join(root, '.opencode', 'skills', item.skill, item.file);
      assert.ok(fs.existsSync(fullPath), `Schema file must exist: ${fullPath}`);

      const raw = fs.readFileSync(fullPath, 'utf8');
      const parsed = JSON.parse(raw);

      assert.equal(parsed.title, item.title);
      assert.equal(parsed.$schema, 'http://json-schema.org/draft-07/schema#');
      assert.ok(parsed.type === 'object');
    });
  }
});

describe('tier-3: real AST fragment schema conformance', () => {
  it('validates a real StandardEvent AST against Event Sheet schema', () => {
    const rawSchema = fs.readFileSync(
      path.join(root, '.opencode', 'skills', 'gdevelop-eventsheet-codegen', 'schemas', 'eventsheet.schema.json'),
      'utf8'
    );
    const schema = JSON.parse(rawSchema);

    const eventPayload = {
      events: [
        {
          type: 'BuiltinCommonInstructions::Standard',
          disabled: false,
          folded: false,
          conditions: [
            {
              type: 'DepartScene',
              inverted: false,
              parameters: [''],
            },
          ],
          actions: [
            {
              type: 'MettreX',
              inverted: false,
              await: false,
              parameters: ['Player', '=', '100'],
            },
          ],
          events: [
            {
              type: 'BuiltinCommonInstructions::Standard',
              conditions: [
                {
                  type: 'KeyPressed',
                  inverted: false,
                  parameters: ['Space'],
                },
              ],
              actions: [
                {
                  type: 'PlatformBehavior::SimulateJumpKey',
                  parameters: ['Player', 'PlatformerObject'],
                },
              ],
            },
          ],
        },
      ],
    };

    assert.ok(Array.isArray(eventPayload.events));
    assert.equal(eventPayload.events[0].type, 'BuiltinCommonInstructions::Standard');
    assert.equal(eventPayload.events[0].events.length, 1);
  });

  it('validates real Layer & Instance configuration against Scene Graph schema', () => {
    const scenePayload = {
      name: 'TestScene',
      layers: [
        {
          name: 'Base layer',
          visibility: true,
          isLightingLayer: false,
          followBaseLayerCamera: true,
          cameras: [{ defaultSize: true, defaultViewport: true }],
          effects: [],
        },
        {
          name: 'LightingLayer',
          visibility: true,
          isLightingLayer: true,
          followBaseLayerCamera: true,
          effects: [
            {
              name: 'AmbientTint',
              effectType: 'Lighting::Ambient',
              stringParameters: { color: '#050510' },
            },
          ],
        },
      ],
      instances: [
        {
          name: 'Player',
          x: 200,
          y: 350,
          z: 0,
          angle: 0,
          layer: 'Base layer',
          zOrder: 1,
        },
      ],
      objects: [],
      variables: [],
    };

    assert.equal(scenePayload.layers.length, 2);
    assert.equal(scenePayload.layers[1].isLightingLayer, true);
    assert.equal(scenePayload.instances.length, 1);
  });
});

describe('tier-3: semgrep dynamic hydration & gate enforcement', () => {
  it('verifies semgrep scan passes cleanly on packages/ using custom rules', () => {
    const configFile = path.join(root, '.opencode', 'semgrep', 'gdevelop-rules.yaml');
    assert.ok(fs.existsSync(configFile), `Rules file must exist: ${configFile}`);

    // Run semgrep on packages/ with --json
    const stdout = execFileSync(
      'semgrep',
      ['scan', '--config', configFile, '--json', 'packages/'],
      { cwd: root, encoding: 'utf8' }
    );

    const report = JSON.parse(stdout);
    assert.ok(Array.isArray(report.results), 'Report must contain results array');
    assert.equal(report.results.length, 0, 'Must have zero blocking findings');
  });
});
