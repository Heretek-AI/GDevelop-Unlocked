// Single source of truth for Tier-1 unlock payloads (Phase 3).
//
// Consumed by:
//   - scripts/generate-tier1-patches.mjs (serializes these objects into
//     patch 01, so patches/ and the runtime hook can never disagree),
//   - launcher/preload-unlock.cjs (renderer fetch/XHR spoof bodies +
//     fallback-source composition),
//   - launcher/heretek-hook.cjs (main-process webRequest spoof bodies).
//
// Shapes satisfy the upstream validators frozen in Phase 1:
//   GET /limits           -> ensureObjectHasProperty(..., 'capabilities')
//   GET /subscription-v2  -> ensureObjectHasProperty(..., 'userId')
// Full URLs: https://api.gdevelop.io/usage/{limits,subscription-v2}.
// Firebase auth/JWT untouched — logged-out walls elsewhere remain.
'use strict';

const USAGE_API_BASE = 'https://api.gdevelop.io/usage';
const SPOOFED_LIMITS_PATH = '/limits';
const SPOOFED_SUBSCRIPTION_PATH = '/subscription-v2';

// Mirrors UNLOCKED_HERETEK_SUBSCRIPTION in patch 01 (and the fork).
const UNLOCKED_SUBSCRIPTION = {
  userId: 'local-byok-user',
  planId: 'gdevelop_startup',
  pricingSystemId: 'HERETEK_UNLOCKED',
  createdAt: 0,
  updatedAt: 0,
};

// Mirrors UNLOCKED_HERETEK_CAPABILITIES in patch 01 (and the fork).
// Satisfies the upstream `Capabilities` Flow type.
const UNLOCKED_CAPABILITIES = {
  analytics: {
    sessions: true,
    players: true,
    retention: true,
    sessionsTimeStats: true,
    platforms: true,
  },
  cloudProjects: {
    maximumCount: 999,
    canMaximumCountBeIncreased: true,
    maximumGuestCollaboratorsPerProject: 99,
    projectRestorationTimeWindowInSeconds: -1,
    deletedProjectRetentionInDays: 365,
  },
  leaderboards: {
    maximumCountPerGame: 999,
    canMaximumCountPerGameBeIncreased: true,
    themeCustomizationCapabilities: 'FULL',
    canUseCustomCss: true,
    canDisableLoginInLeaderboard: true,
  },
  multiplayer: {
    lobbiesCount: 99,
    maxPlayersPerLobby: 64,
    themeCustomizationCapabilities: 'FULL',
  },
  versionHistory: {
    enabled: true,
    retentionDays: 365,
  },
  ai: {
    availablePresets: [],
    versionHistory: {
      enabled: true,
      retentionDays: 365,
    },
  },
};

// NOTE: keep these builders dependency-free and self-contained (no
// module-scope references besides the UNLOCKED_* consts, which the
// fallback-source composer embeds by name). preload-unlock.cjs stringifies
// them into renderer windows, so closures over other locals WILL break
// the fallback path — tests/launcher/preload.test.cjs evaluates the
// composed source in a vm sandbox to pin this.
function buildSubscriptionPayload(
  subscription /*: void | {||} */ = UNLOCKED_SUBSCRIPTION
) {
  return subscription;
}

function buildLimitsPayload(
  capabilities /*: void | {||} */ = UNLOCKED_CAPABILITIES
) {
  return {
    quotas: {},
    capabilities: capabilities,
    credits: {
      userBalance: { amount: 999999 },
      prices: {},
      purchasableQuantities: [],
    },
    message: undefined,
  };
}

/**
 * True only for the two GET endpoints the Tier-1 runtime hook spoofs.
 * Everything else (generation, builds, auth, POST/PUT/DELETE) passes
 * through untouched — the hook never mints credits or touches hosted
 * mutations.
 */
function isSpoofedUsageUrl(url, method) {
  if (!url || typeof url !== 'string') return false;
  const upperMethod = (method || 'GET').toUpperCase();
  if (upperMethod !== 'GET') return false;
  if (url.indexOf(USAGE_API_BASE) !== 0) return false;
  const pathAndQuery = url.slice(USAGE_API_BASE.length);
  return (
    pathAndQuery === SPOOFED_LIMITS_PATH ||
    pathAndQuery.indexOf(SPOOFED_LIMITS_PATH + '?') === 0 ||
    pathAndQuery === SPOOFED_SUBSCRIPTION_PATH ||
    pathAndQuery.indexOf(SPOOFED_SUBSCRIPTION_PATH + '?') === 0
  );
}

function spoofBodyForUrl(url, method) {
  if (!isSpoofedUsageUrl(url, method)) return null;
  const pathAndQuery = url.slice(USAGE_API_BASE.length);
  if (
    pathAndQuery === SPOOFED_LIMITS_PATH ||
    pathAndQuery.indexOf(SPOOFED_LIMITS_PATH + '?') === 0
  ) {
    return buildLimitsPayload();
  }
  return buildSubscriptionPayload();
}

module.exports = {
  USAGE_API_BASE,
  SPOOFED_LIMITS_PATH,
  SPOOFED_SUBSCRIPTION_PATH,
  UNLOCKED_SUBSCRIPTION,
  UNLOCKED_CAPABILITIES,
  buildSubscriptionPayload,
  buildLimitsPayload,
  isSpoofedUsageUrl,
  spoofBodyForUrl,
};
