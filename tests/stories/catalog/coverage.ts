// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type CatalogStatus = 'confirmed' | 'forward-only' | 'gap' | 'contract-only'

type CatalogScenarioId = (typeof CATALOG_SCENARIO_IDS)[number]

export type NonEmptyReadonlyTuple<T> = readonly [T, ...T[]]

export class PendingReason {
  readonly #value: string

  private constructor(value: string) {
    this.#value = value
  }

  toString(): string {
    return this.#value
  }

  static from(value: string): PendingReason {
    const trimmed = value.trim()
    if (trimmed === '') throw new Error('Pending reason must not be empty')
    return new PendingReason(trimmed)
  }
}

export type CatalogCoverage =
  | Readonly<{
      scenarioId: CatalogScenarioId
      catalogStatus: CatalogStatus
      kind: 'executable'
      verifiedAt: '2026-07-13'
      storyIds: NonEmptyReadonlyTuple<string>
    }>
  | Readonly<{
      scenarioId: CatalogScenarioId
      catalogStatus: CatalogStatus
      kind: 'pending'
      verifiedAt: '2026-07-13'
      reason: PendingReason
      requiredSeam?: string
    }>

export const CATALOG_SOURCE = 'scenario-catalog snapshot supplied 2026-07-13' as const

export const CATALOG_SCENARIO_IDS = Object.freeze([
  'SCN-task-create-update',
  'SCN-task-query',
  'SCN-task-delete',
  'SCN-task-history',
  'SCN-task-comments',
  'SCN-task-labels',
  'SCN-task-relations',
  'SCN-task-statuses',
  'SCN-task-projects',
  'SCN-task-project-team',
  'SCN-task-worklog',
  'SCN-task-sprints',
  'SCN-task-saved-queries',
  'SCN-task-collaboration',
  'SCN-task-identity',
  'SCN-task-attachments',
  'SCN-task-youtrack-command',
  'SCN-task-not-configured',
  'SCN-task-guest-readonly',
  'SCN-task-ask-confirm',
  'SCN-task-deny',
  'SCN-memo-save',
  'SCN-memo-recall',
  'SCN-memo-archive',
  'SCN-memo-promote',
  'SCN-reminder-recurring-create',
  'SCN-reminder-recurring-manage',
  'SCN-reminder-recurring-fire',
  'SCN-deferred-schedule-create',
  'SCN-deferred-alert-create',
  'SCN-deferred-manage',
  'SCN-deferred-fire-scheduled',
  'SCN-deferred-fire-alert',
  'SCN-memory-remember',
  'SCN-memory-recall',
  'SCN-memory-forget',
  'SCN-memory-capture-sweep',
  'SCN-memory-promotion-sweep',
  'SCN-web-fetch',
  'SCN-web-fetch-rate-limit-deny',
  'SCN-fetch-chat-link',
  'SCN-instructions-save',
  'SCN-instructions-list-delete',
  'SCN-history-lookup',
  'SCN-meta-expand-result',
  'SCN-meta-search-tools',
  'SCN-meta-load-tool',
  'SCN-coding-acp-start-fresh',
  'SCN-coding-acp-start-on-pr',
  'SCN-coding-acp-cautious-permission-roundtrip',
  'SCN-coding-acp-list-sessions',
  'SCN-coding-acp-session-status',
  'SCN-coding-acp-list-projects',
  'SCN-coding-acp-list-agents',
  'SCN-coding-acp-finish-push',
  'SCN-coding-acp-finish-pr',
  'SCN-coding-acp-cancel',
  'SCN-coding-acp-continue-followup',
  'SCN-coding-acp-continue-by-pr',
  'SCN-coding-acp-mcp-session',
  'SCN-coding-acp-not-configured',
  'SCN-coding-acp-self-hosted-forge-preflight',
  'SCN-coding-acp-whomayuse-denied',
  'SCN-coding-acp-guest-denied',
  'SCN-coding-acp-command',
  'SCN-coding-nerv-create',
  'SCN-coding-nerv-create-conflict',
  'SCN-coding-nerv-create-not-configured',
  'SCN-coding-nerv-whomayuse-denied',
  'SCN-coding-nerv-status',
  'SCN-coding-nerv-list',
  'SCN-coding-nerv-followup',
  'SCN-coding-nerv-steer',
  'SCN-coding-nerv-cancel',
  'SCN-supervise-reconcile-sweep',
  'SCN-supervise-magi-notify-reconcile',
  'SCN-supervise-fleet-health',
  'SCN-supervise-status-sync',
  'SCN-supervise-stale-task',
  'SCN-supervise-stale-review-notify',
  'SCN-supervise-pipeline-failure',
  'SCN-supervise-review-comment',
  'SCN-supervise-mr-merged',
  'SCN-supervise-self-review',
  'SCN-coding-nerv-forge-event-source',
  'SCN-cmd-help',
  'SCN-cmd-start',
  'SCN-cmd-config-dm',
  'SCN-cmd-config-group',
  'SCN-cmd-context',
  'SCN-cmd-clear-self',
  'SCN-cmd-clear-target-user',
  'SCN-cmd-clear-all',
  'SCN-cmd-clear-group-denied',
  'SCN-cmd-dashboard',
  'SCN-cmd-stop-noop',
  'SCN-cmd-stop-graceful',
  'SCN-cmd-stop-abort',
  'SCN-cmd-acp',
  'SCN-cmd-nerv',
  'SCN-cmd-announce',
  'SCN-interaction-discord-router-wrapped',
  'SCN-interaction-discord-standalone-fallback',
  'SCN-interaction-telegram-callback',
  'SCN-interaction-permission-decision',
  'SCN-settings-bootstrap',
  'SCN-settings-identity',
  'SCN-settings-instances',
  'SCN-settings-context-config',
  'SCN-settings-coding-agent-provider',
  'SCN-settings-coding-forge',
  'SCN-settings-coding-mcp',
  'SCN-settings-coding-repos',
  'SCN-settings-admin-guardrails',
  'SCN-settings-admin-mcp-catalog',
  'SCN-settings-admin-mcp-plugin-servers',
  'SCN-settings-admin-system-access',
  'SCN-settings-admin-roster-announce',
  'SCN-http-notify',
  'SCN-http-transcript-viewer',
  'SCN-http-mcp-plugin',
  'SCN-http-auth-claim',
  'SCN-http-mattermost-action',
  'SCN-http-admin-dashboard',
  'SCN-http-billing-stats-readonly',
  'SCN-http-debug-live-panels',
] as const)

const GAP_SCENARIO_IDS = new Set<CatalogScenarioId>([
  'SCN-coding-nerv-steer',
  'SCN-supervise-self-review',
  'SCN-cmd-announce',
  'SCN-http-transcript-viewer',
])

const FORWARD_ONLY_SCENARIO_IDS = new Set<CatalogScenarioId>([
  'SCN-coding-acp-whomayuse-denied',
  'SCN-coding-acp-guest-denied',
  'SCN-interaction-discord-router-wrapped',
  'SCN-interaction-discord-standalone-fallback',
  'SCN-interaction-telegram-callback',
  'SCN-interaction-permission-decision',
  'SCN-http-mattermost-action',
])

function catalogStatusFor(scenarioId: CatalogScenarioId): CatalogStatus {
  if (GAP_SCENARIO_IDS.has(scenarioId)) return 'gap'
  if (scenarioId === 'SCN-coding-nerv-forge-event-source') return 'contract-only'
  if (FORWARD_ONLY_SCENARIO_IDS.has(scenarioId) || scenarioId.startsWith('SCN-cmd-')) return 'forward-only'
  return 'confirmed'
}

export function toPendingReason(value: string): PendingReason {
  return PendingReason.from(value)
}

function pendingReasonFor(catalogStatus: CatalogStatus): PendingReason {
  if (catalogStatus === 'gap') return toPendingReason('Catalog gap: awaiting a local executable story.')
  if (catalogStatus === 'contract-only')
    return toPendingReason('Contract-only non-trigger: no executable story is expected.')
  return toPendingReason('Awaiting branch audit before classifying an executable story.')
}

export const catalogCoverage: readonly CatalogCoverage[] = Object.freeze(
  CATALOG_SCENARIO_IDS.map((scenarioId) =>
    Object.freeze({
      scenarioId,
      catalogStatus: catalogStatusFor(scenarioId),
      kind: 'pending' as const,
      verifiedAt: '2026-07-13' as const,
      reason: pendingReasonFor(catalogStatusFor(scenarioId)),
    }),
  ),
)
