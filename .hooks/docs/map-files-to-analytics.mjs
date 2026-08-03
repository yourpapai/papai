// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * @typedef {Object} AnalyticsArea
 * @property {string} area - Human-readable name of the analytics-covered surface
 * @property {string[]} artifacts - Analytics files/actions that may need updating
 * @property {string} verify - Command that proves the surface stayed consistent
 * @property {string[]} triggers - Changed files that matched this area
 */

/**
 * @typedef {Object} AnalyticsAreaRule
 * @property {string} area
 * @property {RegExp[]} patterns
 * @property {string[]} artifacts
 * @property {string} verify
 */

/** @type {AnalyticsAreaRule[]} */
const AREA_RULES = [
  {
    area: 'tool surface (slugs, classification, log fields)',
    patterns: [/^src\/tools\//, /^plugins\/[^/]+\/plugin\.json$/],
    artifacts: [
      'src/analytics/generated/tool-slugs.ts — regenerate with: bun scripts/generate-analytics-tool-slugs.ts',
      'src/tools/tool-metadata.ts — domain/risk metadata drives src/analytics/tool-classification.ts',
      'dynamic log fields of new/changed tools are covered by the logging-privacy static closure',
    ],
    verify:
      'bun test tests/analytics/tool-slug-generation.test.ts tests/analytics/tool-classification.test.ts tests/tools/logging-privacy.test.ts',
  },
  {
    area: 'analytics contracts/registry (versioned definitions)',
    patterns: [
      /^src\/analytics\/contracts\.ts$/,
      /^src\/analytics\/registry(-events)?\.ts$/,
      /^src\/analytics\/event-props.*\.ts$/,
      /^src\/analytics\/controlled-types\.ts$/,
      /^src\/analytics\/normalizer.*\.ts$/,
    ],
    artifacts: [
      'docs/research/analytics-metrics/02-metric-catalog.md — amend the versioned spec through review, never silently',
      'docs/research/analytics-metrics/03-privacy-consent-threat-model.md — privacy classes/consent implications',
      'tests/analytics/privacy-contract.test.ts — the 17-control release-blocking matrix',
    ],
    verify:
      'bun test tests/analytics/registry-closure.test.ts tests/analytics/privacy-contract.test.ts tests/analytics/contracts.test.ts',
  },
  {
    area: 'analytics runtime/storage/governance/delivery/derive/rekey/jobs',
    patterns: [/^src\/analytics\//],
    artifacts: [
      'docs/operations/analytics-runbook.md — operator behavior, commands, stage gates',
      'docs/architecture/behaviors.md — only if runtime-visible behavior changed',
      'tests/analytics/ — mirrored suites for the touched submodule',
    ],
    verify: 'bun test tests/analytics',
  },
  {
    area: 'instrumentation boundary (typed fact emission)',
    patterns: [
      /^src\/bot(-[a-z-]+)?\.ts$/,
      /^src\/llm-orchestrator/,
      /^src\/live-status\//,
      /^src\/mcp\//,
      /^src\/deferred-prompts\//,
      /^src\/providers\//,
      /^src\/chat\//,
      /^src\/message-queue\//,
      /^src\/reply-typing-heartbeat\.ts$/,
      /^src\/tool-failure\.ts$/,
      /^src\/identity\//,
      /^src\/runtime\/production-/,
      /^src\/scheduler-instance\.ts$/,
    ],
    artifacts: [
      'typed source facts are constructed field-by-field at this boundary — never spread payloads, args, results, errors, or log records',
      'observer wiring: src/analytics/subscriber.ts, bot-observer.ts, turn-observer.ts, provider-observer.ts, feature-observer.ts',
    ],
    verify:
      'bun test tests/analytics/llm-tool-integration.test.ts tests/analytics/message-turn-integration.test.ts tests/analytics/source-facts-boundary.test.ts',
  },
  {
    area: 'database schema/migrations',
    patterns: [/^src\/db\//],
    artifacts: [
      'src/db/index.ts — migration registration order',
      'analytics tables change → src/db/analytics-*-schema.ts parity and the four analytics migration blocks stay consecutive',
    ],
    verify: 'bun test tests/db/migration-registration.test.ts tests/db',
  },
  {
    area: 'settings analytics UI/API',
    patterns: [/^client\/settings\/.*analytics/i, /^src\/debug\/settings\/.*analytics/i],
    artifacts: [
      'client/settings/fetcher-schemas-analytics.ts ↔ src/debug/settings/**/analytics-*-routes.ts schema parity',
      'docs/operations/analytics-runbook.md — lanes and switches section if policy surface changed',
    ],
    verify:
      'bun test tests/debug/settings tests/client/settings && bun run test:client',
  },
  {
    area: 'analytics operator CLIs',
    patterns: [/^scripts\/analytics-.*\.ts$/, /^scripts\/generate-analytics-tool-slugs\.ts$/],
    artifacts: [
      'docs/operations/analytics-runbook.md — operator command blocks must match the CLIs verbatim (flags, output lines, exit codes)',
    ],
    verify: 'bun test tests/analytics/jobs tests/analytics/backfill.test.ts',
  },
]

/**
 * Map changed source file paths to analytics surfaces that may need updating.
 * @param {string[]} changedFiles - Relative paths of changed source files
 * @returns {AnalyticsArea[]} Matched areas with their triggering files, in rule order
 */
export function mapFilesToAnalytics(changedFiles) {
  if (changedFiles.length === 0) return []

  /** @type {AnalyticsArea[]} */
  const areas = []
  for (const rule of AREA_RULES) {
    const triggers = changedFiles.filter((file) => rule.patterns.some((pattern) => pattern.test(file)))
    if (triggers.length === 0) continue
    areas.push({ area: rule.area, artifacts: rule.artifacts, verify: rule.verify, triggers })
  }

  return areas
}
