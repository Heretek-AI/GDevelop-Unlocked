// Phase 1 seam: branding/clamp gates (Phase 2 hunk 4 targets).
// Audit: `ProjectManager/LoadingScreenEditor.js` — logo guard (~`:106-117`),
// watermark guard + forced-duration clamp (~`:162-213`).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  readUpstream,
  mustContain,
  mustMatchWord,
  mustBeNearLine,
  findAllLines,
} from './helpers.mjs';

const REL = 'newIDE/app/src/ProjectManager/LoadingScreenEditor.js';

describe('seam: LoadingScreenEditor branding gates', () => {
  const file = readUpstream(REL);

  it('keeps the startup-logo paywall guard', () => {
    mustMatchWord(file, 'isGDevelopLogoShownDuringLoadingScreen', {
      what: 'logo-branding predicate',
    });
    mustBeNearLine(
      file,
      /checked=\{loadingScreen\.isGDevelopLogoShownDuringLoadingScreen/,
      106,
      40,
      'logo checkbox guard'
    );
  });

  it('keeps the watermark paywall guard + clamp', () => {
    mustMatchWord(file, 'isGDevelopWatermarkShown', {
      what: 'watermark predicate',
    });
    mustBeNearLine(
      file,
      /checked=\{watermark\.isGDevelopWatermarkShown/,
      162,
      40,
      'watermark checkbox guard'
    );
    mustContain(file, 'forcedLogo.minDuration', {
      what: 'forced splash-duration clamp',
    });
    mustContain(file, 'setMinDuration(forcedLogo.minDuration)', {
      what: 'clamp write-back on watermark disable',
    });
  });

  it('both guards consult the subscription checker', () => {
    mustMatchWord(file, 'subscriptionChecker', {
      what: 'checker ref in branding panel',
    });
    mustMatchWord(file, 'checkUserHasSubscription', {
      what: 'dialog path when unchecking without subscription',
    });
    mustMatchWord(file, 'hasUserSubscription', {
      what: 'silent path for the duration clamp',
    });
  });

  it('predicates are referenced pervasively (not dead code)', () => {
    const logoHits = findAllLines(
      file.text,
      /isGDevelopLogoShownDuringLoadingScreen/
    ).length;
    const watermarkHits = findAllLines(file.text, /isGDevelopWatermarkShown/)
      .length;
    assert.ok(
      logoHits >= 3 && watermarkHits >= 3,
      `SEAM DRIFT: branding predicates look dead (logo x${logoHits}, watermark x${watermarkHits}). ` +
        `File: ${file.abs}. Expected >= 3 references each.`
    );
  });
});
