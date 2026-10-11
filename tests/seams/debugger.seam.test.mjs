// Phase 1 seam: in-game debugger gate.
// Audit: `MainFrame/EditorContainers/DebuggerEditorContainer.js:135-146`.
import { describe, it } from 'node:test';
import {
  readUpstream,
  mustContain,
  mustMatchWord,
  mustBeNearLine,
} from './helpers.mjs';

const REL =
  'newIDE/app/src/MainFrame/EditorContainers/DebuggerEditorContainer.js';

describe('seam: DebuggerEditorContainer gate', () => {
  const file = readUpstream(REL);

  it('keeps the _checkUserHasSubscription guard', () => {
    mustMatchWord(file, '_checkUserHasSubscription', {
      what: 'debugger paywall entry point',
      hint: 'Phase 2 hunk 5 stubs the body',
    });
  });

  it('guard sits at its audited hunk (~line 135, tolerance ±30)', () => {
    mustBeNearLine(
      file,
      /_checkUserHasSubscription\(\) \{/,
      135,
      30,
      '_checkUserHasSubscription'
    );
  });

  it('guard shape: checker + isActive + one-shot flag', () => {
    for (const token of [
      'this._subscriptionChecker',
      'this.props.isActive',
      'subscriptionChecked',
    ]) {
      mustContain(file, token, { what: 'guard condition' });
    }
    mustMatchWord(file, 'checkUserHasSubscription', {
      what: 'checker invocation inside the guard',
    });
  });

  it('debugger tab mounts a SubscriptionChecker with id="Debugger"', () => {
    mustContain(file, 'id="Debugger"', {
      what: 'checker placement id for the debugger tab',
    });
    mustContain(file, 'placementId="debugger"', {
      what: 'analytics placement id',
    });
  });
});
