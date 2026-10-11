// Phase 1 seam: hot-reload + network-preview gates.
// Audit: `LocalPreviewLauncher/index.js:439-448` (`% 16` block) and
// `:489-493` (`_checkSubscriptionForNetworkPreview`).
import { describe, it } from 'node:test';
import {
  readUpstream,
  mustContain,
  mustMatchWord,
  mustBeNearLine,
} from './helpers.mjs';

const REL =
  'newIDE/app/src/ExportAndShare/LocalExporters/LocalPreviewLauncher/index.js';

describe('seam: LocalPreviewLauncher gates', () => {
  const file = readUpstream(REL);

  it('keeps the % 16 hot-reload paywall block', () => {
    mustContain(file, 'hotReloadsCount % 16 === 0', {
      what: 'hot-reload paywall cadence',
      hint: 'Phase 2 hunk 5 deletes this block',
    });
    mustMatchWord(file, '_hotReloadSubscriptionChecker', {
      what: 'checker ref driving the % 16 popup',
    });
    mustMatchWord(file, 'checkUserHasSubscription', {
      what: 'checker call inside the % 16 block',
    });
  });

  it('% 16 block sits at its audited hunk (~line 441, tolerance ±40)', () => {
    mustBeNearLine(
      file,
      /hotReloadsCount % 16 === 0/,
      441,
      40,
      '% 16 hot-reload gate'
    );
  });

  it('keeps the network-preview subscription stub point', () => {
    mustMatchWord(file, '_checkSubscriptionForNetworkPreview', {
      what: 'wifi/LAN preview gate',
      hint: 'Phase 2 hunk 5 stubs this to `return true`',
    });
    mustMatchWord(file, '_networkPreviewSubscriptionChecker', {
      what: 'network preview checker ref',
    });
  });

  it('increments hotReloadsCount after the gate', () => {
    mustContain(file, 'hotReloadsCount: state.hotReloadsCount + 1', {
      what: 'counter increment following the gate',
    });
  });
});
