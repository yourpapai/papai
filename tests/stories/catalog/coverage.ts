// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type CatalogStatus = 'confirmed' | 'forward-only' | 'gap' | 'contract-only'

type CatalogScenarioId = (typeof CATALOG_SCENARIO_IDS)[number]

export type NonEmptyReadonlyTuple<T> = readonly [T, ...T[]]

export const STORY_FAMILIES = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'unqueued'] as const
export type StoryFamily = (typeof STORY_FAMILIES)[number]

export const STORY_SEAM_IDS = [
  'capability-ids',
  'memory-task-provider-expansion',
  'attachments-relay',
  'compaction-trigger',
  'mid-turn-run-control',
  'fake-mcp-server',
  'fake-magi-transcript',
  'dashboard-auth-fixture',
  'debug-enabled-world-option',
  'notify-token-fixture',
  'mattermost-action-fixture',
  'scheduler-due-seed',
  'embeddings-endpoint',
  'memory-extraction-llm',
  'public-url-assertion',
  'platform-adapter-fakes',
] as const
export type StorySeamId = (typeof STORY_SEAM_IDS)[number]

export type AuditReadiness =
  | Readonly<{ state: 'executable-as-is' }>
  | Readonly<{ state: 'needs-seam'; seams: NonEmptyReadonlyTuple<StorySeamId> }>
  | Readonly<{ state: 'blocked'; blocker: 'missing-implementation' }>

export type AuditRecord = Readonly<{
  readiness: AuditReadiness
  family: StoryFamily
  rationale: PendingReason
}>

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
      verifiedAt: string
      storyIds: NonEmptyReadonlyTuple<string>
    }>
  | Readonly<{
      scenarioId: CatalogScenarioId
      catalogStatus: CatalogStatus
      kind: 'pending'
      verifiedAt: string
      audit: AuditRecord
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
  'SCN-context-thread-scope',
  'SCN-context-group-identity',
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
  'SCN-http-mattermost-action',
])

function catalogStatusFor(scenarioId: CatalogScenarioId): CatalogStatus {
  if (GAP_SCENARIO_IDS.has(scenarioId)) return 'gap'
  if (scenarioId === 'SCN-coding-nerv-forge-event-source') return 'contract-only'
  if (FORWARD_ONLY_SCENARIO_IDS.has(scenarioId)) return 'forward-only'
  return 'confirmed'
}

export function toPendingReason(value: string): PendingReason {
  return PendingReason.from(value)
}

type ExecutableStoryMapping = Readonly<{ verifiedAt: string; storyIds: NonEmptyReadonlyTuple<string> }>

const EXECUTABLE_STORY_MAPPINGS: Partial<Record<CatalogScenarioId, ExecutableStoryMapping>> = {
  'SCN-coding-acp-command': {
    verifiedAt: '2026-07-13',
    storyIds: [
      'tests/stories/integrations/runtime-extensions/command-prompt.story.test.ts#SCN-coding-acp-command: eligible and ineligible runtime extension command and prompt',
    ],
  },
  'SCN-coding-acp-start-fresh': {
    verifiedAt: '2026-07-13',
    storyIds: [
      'tests/stories/integrations/coding-sessions/module-qualification.story.test.ts#SCN-coding-acp-start-fresh: starts a configured session through the real ACP tool loop',
    ],
  },
  'SCN-coding-acp-start-on-pr': {
    verifiedAt: '2026-07-13',
    storyIds: [
      'tests/stories/integrations/coding-sessions/acp-lifecycle.story.test.ts#SCN-coding-acp-start-on-pr: starts a configured session with PR and forge token',
    ],
  },
  'SCN-coding-acp-cautious-permission-roundtrip': {
    verifiedAt: '2026-07-13',
    storyIds: [
      'tests/stories/integrations/coding-sessions/acp-controls.story.test.ts#SCN-coding-acp-cautious-permission-roundtrip: resolves matching cautious decisions and leaves empty queues untouched',
    ],
  },
  'SCN-coding-acp-list-sessions': {
    verifiedAt: '2026-07-13',
    storyIds: [
      'tests/stories/integrations/coding-sessions/acp-lifecycle.story.test.ts#SCN-coding-acp-list-sessions: returns only sessions known to this chat',
    ],
  },
  'SCN-coding-acp-session-status': {
    verifiedAt: '2026-07-13',
    storyIds: [
      'tests/stories/integrations/coding-sessions/acp-lifecycle.story.test.ts#SCN-coding-acp-session-status: preserves a declared missing-session response without local mutation',
    ],
  },
  'SCN-coding-acp-list-projects': {
    verifiedAt: '2026-07-13',
    storyIds: [
      'tests/stories/integrations/coding-sessions/acp-lifecycle.story.test.ts#SCN-coding-acp-list-projects: lists the local repository catalogue without Magi',
    ],
  },
  'SCN-coding-acp-list-agents': {
    verifiedAt: '2026-07-13',
    storyIds: [
      'tests/stories/integrations/coding-sessions/acp-lifecycle.story.test.ts#SCN-coding-acp-list-agents: gets available agents through guarded Magi HTTP',
    ],
  },
  'SCN-coding-acp-finish-push': {
    verifiedAt: '2026-07-13',
    storyIds: [
      'tests/stories/integrations/coding-sessions/acp-controls.story.test.ts#SCN-coding-acp-finish-push: pushes with the exact requested finish payload',
    ],
  },
  'SCN-coding-acp-finish-pr': {
    verifiedAt: '2026-07-13',
    storyIds: [
      'tests/stories/integrations/coding-sessions/acp-controls.story.test.ts#SCN-coding-acp-finish-pr: opens a PR with the exact requested title and body',
    ],
  },
  'SCN-coding-acp-cancel': {
    verifiedAt: '2026-07-13',
    storyIds: [
      'tests/stories/integrations/coding-sessions/acp-controls.story.test.ts#SCN-coding-acp-cancel: cancels exactly the selected coding session',
    ],
  },
  'SCN-coding-acp-continue-followup': {
    verifiedAt: '2026-07-13',
    storyIds: [
      'tests/stories/integrations/coding-sessions/acp-controls.story.test.ts#SCN-coding-acp-continue-followup: continues a locally known session and records its child',
    ],
  },
  'SCN-coding-acp-continue-by-pr': {
    verifiedAt: '2026-07-13',
    storyIds: [
      'tests/stories/integrations/coding-sessions/acp-controls.story.test.ts#SCN-coding-acp-continue-by-pr: follows up only the locally known matching PR session',
    ],
  },
  'SCN-coding-acp-mcp-session': {
    verifiedAt: '2026-07-13',
    storyIds: [
      'tests/stories/integrations/coding-sessions/acp-mcp.story.test.ts#SCN-coding-acp-mcp-session: starts a session with an exact configured MCP upstream and credential map',
    ],
  },
  'SCN-coding-acp-not-configured': {
    verifiedAt: '2026-07-13',
    storyIds: [
      'tests/stories/integrations/coding-sessions/module-qualification.story.test.ts#SCN-coding-acp-not-configured: refuses an unconfigured start without creating a session',
    ],
  },
  'SCN-coding-acp-self-hosted-forge-preflight': {
    verifiedAt: '2026-07-13',
    storyIds: [
      'tests/stories/integrations/coding-sessions/acp-lifecycle.story.test.ts#SCN-coding-acp-self-hosted-forge-preflight: refuses a self-hosted repository without forge settings',
    ],
  },
  'SCN-coding-acp-whomayuse-denied': {
    verifiedAt: '2026-07-13',
    storyIds: [
      'tests/stories/integrations/coding-sessions/module-qualification.story.test.ts#SCN-coding-acp-whomayuse-denied: hides session start from an operator-denied member',
    ],
  },
  'SCN-coding-acp-guest-denied': {
    verifiedAt: '2026-07-13',
    storyIds: [
      'tests/stories/integrations/coding-sessions/module-qualification.story.test.ts#SCN-coding-acp-guest-denied: hides session start from a guest group turn',
    ],
  },
  'SCN-settings-bootstrap': {
    verifiedAt: '2026-07-18',
    storyIds: [
      'tests/stories/settings/context-and-instances.story.test.ts#SCN-settings-bootstrap: first-run session bootstraps a fresh personal context end to end',
    ],
  },
  'SCN-settings-instances': {
    verifiedAt: '2026-07-18',
    storyIds: [
      'tests/stories/settings/context-and-instances.story.test.ts#SCN-settings-instances: an admin-created task instance becomes assignable and serves the next turn',
    ],
  },
  'SCN-settings-context-config': {
    verifiedAt: '2026-07-18',
    storyIds: [
      'tests/stories/settings/context-and-instances.story.test.ts#SCN-settings-context-config: tool visibility config changes what the next turn posts',
    ],
  },
  'SCN-settings-identity': {
    verifiedAt: '2026-07-18',
    storyIds: [
      'tests/stories/settings/identity.story.test.ts#SCN-settings-identity: identity saved through settings resolves me in the next chat turn',
    ],
  },
  'SCN-settings-coding-agent-provider': {
    verifiedAt: '2026-07-18',
    storyIds: [
      'tests/stories/settings/module-settings-qualification.story.test.ts#SCN-settings-coding-agent-provider: updates coding credentials through settings and changes the next chat turn',
    ],
  },
  'SCN-settings-coding-forge': {
    verifiedAt: '2026-07-18',
    storyIds: [
      'tests/stories/settings/coding-surfaces.story.test.ts#SCN-settings-coding-forge: forge credentials saved through settings reach the session start',
    ],
  },
  'SCN-settings-coding-mcp': {
    verifiedAt: '2026-07-18',
    storyIds: [
      'tests/stories/settings/coding-surfaces.story.test.ts#SCN-settings-coding-mcp: MCP selections saved through settings reach the session start',
    ],
  },
  'SCN-settings-coding-repos': {
    verifiedAt: '2026-07-18',
    storyIds: [
      'tests/stories/settings/coding-surfaces.story.test.ts#SCN-settings-coding-repos: a repository registered through settings is listed and startable',
    ],
  },
  'SCN-settings-admin-guardrails': {
    verifiedAt: '2026-07-18',
    storyIds: [
      'tests/stories/settings/admin-surfaces.story.test.ts#SCN-settings-admin-guardrails: a guardrail saved through settings changes the advertised toolset',
    ],
  },
  'SCN-settings-admin-system-access': {
    verifiedAt: '2026-07-18',
    storyIds: [
      'tests/stories/settings/admin-surfaces.story.test.ts#SCN-settings-admin-system-access: granting admin through settings flips admin authorization',
    ],
  },
  'SCN-settings-admin-roster-announce': {
    verifiedAt: '2026-07-18',
    storyIds: [
      'tests/stories/settings/admin-surfaces.story.test.ts#SCN-settings-admin-roster-announce: an admin broadcast reaches every authorized user',
    ],
  },
  'SCN-task-guest-readonly': {
    verifiedAt: '2026-07-19',
    storyIds: [
      'tests/stories/context/guest-readonly.story.test.ts#guest group turns can read tasks but cannot advertise writes',
    ],
  },
  'SCN-context-thread-scope': {
    verifiedAt: '2026-07-19',
    storyIds: [
      'tests/stories/context/thread-scope.story.test.ts#group threads share config but isolate conversation history',
    ],
  },
  'SCN-context-group-identity': {
    verifiedAt: '2026-07-19',
    storyIds: [
      'tests/stories/context/group-users.story.test.ts#group members share durable config while retaining distinct identities',
    ],
  },
  'SCN-cmd-help': {
    verifiedAt: '2026-07-19',
    storyIds: ['tests/stories/commands/surface.story.test.ts#SCN-cmd-help: shows user help and the admin appendix'],
  },
  'SCN-cmd-start': {
    verifiedAt: '2026-07-19',
    storyIds: ['tests/stories/commands/surface.story.test.ts#SCN-cmd-start: welcomes an authorized user'],
  },
  'SCN-cmd-config-dm': {
    verifiedAt: '2026-07-19',
    storyIds: [
      'tests/stories/commands/surface.story.test.ts#SCN-cmd-config-dm: issues a single-use settings link in DM',
    ],
  },
  'SCN-cmd-config-group': {
    verifiedAt: '2026-07-19',
    storyIds: [
      'tests/stories/commands/surface.story.test.ts#SCN-cmd-config-group: redirects group admins and refuses plain members',
    ],
  },
  'SCN-cmd-context': {
    verifiedAt: '2026-07-19',
    storyIds: ['tests/stories/commands/surface.story.test.ts#SCN-cmd-context: renders the memory context snapshot'],
  },
  'SCN-cmd-clear-self': {
    verifiedAt: '2026-07-19',
    storyIds: [
      'tests/stories/commands/surface.story.test.ts#SCN-cmd-clear-self: clears own history, memory, and facts',
    ],
  },
  'SCN-cmd-clear-target-user': {
    verifiedAt: '2026-07-19',
    storyIds: ['tests/stories/commands/surface.story.test.ts#SCN-cmd-clear-target-user: an admin clears another user'],
  },
  'SCN-cmd-clear-all': {
    verifiedAt: '2026-07-19',
    storyIds: ['tests/stories/commands/surface.story.test.ts#SCN-cmd-clear-all: a super admin clears every user'],
  },
  'SCN-cmd-clear-group-denied': {
    verifiedAt: '2026-07-19',
    storyIds: [
      'tests/stories/commands/surface.story.test.ts#SCN-cmd-clear-group-denied: a plain group member cannot clear',
    ],
  },
  'SCN-cmd-dashboard': {
    verifiedAt: '2026-07-19',
    storyIds: [
      'tests/stories/commands/surface.story.test.ts#SCN-cmd-dashboard: reports the dashboard disabled without DEBUG_SERVER',
    ],
  },
  'SCN-cmd-stop-noop': {
    verifiedAt: '2026-07-19',
    storyIds: ['tests/stories/commands/surface.story.test.ts#SCN-cmd-stop-noop: reports nothing running'],
  },
  'SCN-cmd-stop-graceful': {
    verifiedAt: '2026-07-19',
    storyIds: [
      'tests/stories/commands/surface.story.test.ts#SCN-cmd-stop-graceful: first stop winds down after the current step',
    ],
  },
  'SCN-cmd-stop-abort': {
    verifiedAt: '2026-07-19',
    storyIds: ['tests/stories/commands/surface.story.test.ts#SCN-cmd-stop-abort: second stop aborts immediately'],
  },
  'SCN-cmd-acp': {
    verifiedAt: '2026-07-19',
    storyIds: [
      'tests/stories/commands/surface.story.test.ts#SCN-cmd-acp: shows ACP help in an eligible context and refuses a disabled one',
    ],
  },
  'SCN-meta-search-tools': {
    verifiedAt: '2026-07-19',
    storyIds: [
      'tests/stories/meta/disclosure-and-compaction.story.test.ts#SCN-meta-search-tools: ranks tools lexically through the real search_tools tool',
    ],
  },
  'SCN-meta-load-tool': {
    verifiedAt: '2026-07-19',
    storyIds: [
      'tests/stories/meta/disclosure-and-compaction.story.test.ts#SCN-meta-load-tool: loads a non-advertised tool before calling it',
    ],
  },
  'SCN-meta-expand-result': {
    verifiedAt: '2026-07-19',
    storyIds: [
      'tests/stories/meta/disclosure-and-compaction.story.test.ts#SCN-meta-expand-result: expands a compacted tool result by handle',
    ],
  },
}

function auditRecord(readiness: AuditReadiness, family: StoryFamily, rationale: string): AuditRecord {
  return Object.freeze({ readiness, family, rationale: toPendingReason(rationale) })
}

const ready = (family: StoryFamily, rationale: string): AuditRecord =>
  auditRecord({ state: 'executable-as-is' }, family, rationale)
const needs = (family: StoryFamily, seams: NonEmptyReadonlyTuple<StorySeamId>, rationale: string): AuditRecord =>
  auditRecord({ state: 'needs-seam', seams }, family, rationale)
const blocked = (family: StoryFamily, rationale: string): AuditRecord =>
  auditRecord({ state: 'blocked', blocker: 'missing-implementation' }, family, rationale)

export const AUDIT_RECORDS: Partial<Record<CatalogScenarioId, AuditRecord>> = {
  // F1 — tool assembly, disclosure, and command surface (refactor-risk first)
  'SCN-cmd-nerv': blocked(
    'F1',
    'No /nerv command exists; nerv has no production implementation. Family F1 reviews it if a /nerv command ever lands.',
  ),
  'SCN-cmd-announce': blocked(
    'F1',
    'No chat /announce command exists; admin broadcast via the settings route is covered by SCN-settings-admin-roster-announce. Keeps gap status.',
  ),
  // F2 — conversational task operations
  'SCN-task-create-update': needs(
    'F2',
    ['capability-ids'],
    'Partially covered today by tests/stories/chat-task/create-and-read-task.story.test.ts (create and get only — documented partial coverage, not a mapping); scripting update_task needs a capability id.',
  ),
  'SCN-task-query': needs(
    'F2',
    ['capability-ids', 'memory-task-provider-expansion'],
    'List/search work today; count variants need countTasks on the memory provider plus capability ids.',
  ),
  'SCN-task-delete': needs(
    'F2',
    ['capability-ids', 'memory-task-provider-expansion'],
    'Needs deleteTask on the memory provider and a capability id.',
  ),
  'SCN-task-history': needs(
    'F2',
    ['capability-ids', 'memory-task-provider-expansion'],
    'Needs getTaskHistory (activities.read) on the memory provider and a capability id.',
  ),
  'SCN-task-comments': needs(
    'F2',
    ['capability-ids'],
    'Memory provider comment surface exists; scripting comment tools needs capability ids.',
  ),
  'SCN-task-labels': needs(
    'F2',
    ['capability-ids'],
    'Memory provider label surface exists; scripting label tools needs capability ids.',
  ),
  'SCN-task-relations': needs(
    'F2',
    ['capability-ids', 'memory-task-provider-expansion'],
    'Needs addRelation/updateRelation/removeRelation on the memory provider.',
  ),
  'SCN-task-statuses': needs(
    'F2',
    ['capability-ids', 'memory-task-provider-expansion'],
    'Needs the statuses surface (list/create/update/delete/reorder) on the memory provider.',
  ),
  'SCN-task-projects': needs(
    'F2',
    ['capability-ids', 'memory-task-provider-expansion'],
    'Needs the projects surface on the memory provider.',
  ),
  'SCN-task-project-team': needs(
    'F2',
    ['capability-ids', 'memory-task-provider-expansion'],
    'Needs project team and member provisioning on the memory provider.',
  ),
  'SCN-task-worklog': needs(
    'F2',
    ['capability-ids', 'memory-task-provider-expansion'],
    'Needs the work-items surface on the memory provider.',
  ),
  'SCN-task-sprints': needs(
    'F2',
    ['capability-ids', 'memory-task-provider-expansion'],
    'Needs agiles/sprints on the memory provider.',
  ),
  'SCN-task-saved-queries': needs(
    'F2',
    ['capability-ids', 'memory-task-provider-expansion'],
    'Needs saved queries on the memory provider.',
  ),
  'SCN-task-collaboration': needs(
    'F2',
    ['capability-ids', 'memory-task-provider-expansion'],
    'Needs watchers/votes/visibility on the memory provider.',
  ),
  'SCN-task-identity': needs(
    'F2',
    ['capability-ids', 'memory-task-provider-expansion'],
    'Needs listUsers/getCurrentUser/provisionWorkspaceMember; per-user me-resolution is already covered by SCN-context-group-identity.',
  ),
  'SCN-task-attachments': needs(
    'F2',
    ['capability-ids', 'memory-task-provider-expansion', 'attachments-relay'],
    'Needs the attachment surface plus the incoming-file relay workspace.',
  ),
  'SCN-task-youtrack-command': needs(
    'F2',
    ['capability-ids', 'memory-task-provider-expansion'],
    'Needs applyCommand with YouTrack traits on the memory provider.',
  ),
  'SCN-task-not-configured': ready('F2', 'Refusal path needs no tool call; an unassigned provider is seedable today.'),
  'SCN-task-ask-confirm': ready(
    'F2',
    "tool_prefs 'ask' plus when.interaction permission buttons run in-process today.",
  ),
  'SCN-task-deny': ready(
    'F2',
    "tool_prefs 'deny' filtering is observable via model available-tools inspections today.",
  ),
  // F3 — memory, memos, instructions, history, chat links
  'SCN-memo-save': needs(
    'F3',
    ['capability-ids'],
    'Builtin memo tools execute against the real DB; scripting them needs capability ids.',
  ),
  'SCN-memo-recall': needs(
    'F3',
    ['capability-ids', 'embeddings-endpoint'],
    'Semantic recall needs a declared fake embedding endpoint (or an asserted keyword-fallback path) plus capability ids.',
  ),
  'SCN-memo-archive': needs(
    'F3',
    ['capability-ids'],
    'Builtin memo tools execute against the real DB; scripting them needs capability ids.',
  ),
  'SCN-memo-promote': needs(
    'F3',
    ['capability-ids'],
    'Memo promotion executes against the real DB; scripting it needs a capability id.',
  ),
  'SCN-memory-remember': needs(
    'F3',
    ['capability-ids'],
    'Builtin memory tools execute against the real DB; scripting them needs capability ids.',
  ),
  'SCN-memory-recall': needs(
    'F3',
    ['capability-ids', 'embeddings-endpoint'],
    'Semantic recall needs a declared fake embedding endpoint (or an asserted keyword-fallback path) plus capability ids.',
  ),
  'SCN-memory-forget': needs(
    'F3',
    ['capability-ids'],
    'Builtin memory tools execute against the real DB; scripting them needs capability ids.',
  ),
  'SCN-memory-capture-sweep': needs(
    'F3',
    ['capability-ids', 'memory-extraction-llm'],
    'sweepDirtyContexts(now) is single-pass; the extraction runner needs a model seam or declared HTTP.',
  ),
  'SCN-memory-promotion-sweep': needs(
    'F3',
    ['capability-ids'],
    'sweepPromotions is single-pass and DI-ready; scripting the sweep needs capability ids.',
  ),
  'SCN-instructions-save': needs(
    'F3',
    ['capability-ids'],
    'Instruction tools are DB-backed; scripting them needs capability ids.',
  ),
  'SCN-instructions-list-delete': needs(
    'F3',
    ['capability-ids'],
    'Instruction tools are DB-backed; scripting them needs capability ids.',
  ),
  'SCN-history-lookup': needs(
    'F3',
    ['capability-ids'],
    'The message cache is populated by prior seeded turns; scripting lookup_group_history needs a capability id.',
  ),
  'SCN-fetch-chat-link': needs(
    'F3',
    ['capability-ids', 'public-url-assertion'],
    'The fetch path performs a real DNS lookup unless assertPublicUrl is injected.',
  ),
  // F4 — HTTP surfaces
  'SCN-http-notify': needs(
    'F4',
    ['notify-token-fixture'],
    'Needs a seedable notify_token fixture; note the process-lifetime token cache in src/notify-token.ts.',
  ),
  'SCN-http-transcript-viewer': needs(
    'F4',
    ['fake-magi-transcript'],
    'The transcript proxy targets magi; extend the fake magi to serve transcript bytes. Closes the catalog gap.',
  ),
  'SCN-http-mcp-plugin': needs(
    'F4',
    ['fake-mcp-server'],
    'The plugin-MCP route needs a fake MCP server over the strict dispatcher.',
  ),
  'SCN-http-auth-claim': ready(
    'F4',
    'Real auth-code issue/exchange/session is already proven by the settings family; a dedicated claim story can be authored today.',
  ),
  'SCN-http-mattermost-action': needs(
    'F4',
    ['mattermost-action-fixture'],
    'Action callbacks bypass the session gate but need the test secret option wired into the world; wire verification stays forward-only.',
  ),
  'SCN-http-admin-dashboard': needs(
    'F4',
    ['dashboard-auth-fixture'],
    'The admin dashboard is a separate trust domain from settings sessions.',
  ),
  'SCN-http-billing-stats-readonly': needs(
    'F4',
    ['dashboard-auth-fixture'],
    'Billing/stats share the dashboard trust domain, not the settings session vault.',
  ),
  'SCN-http-debug-live-panels': needs(
    'F4',
    ['debug-enabled-world-option'],
    'The world hardcodes debugEnabled:false; debug-only paths 404 until a world option exists.',
  ),
  // F5 — reminders and deferred work
  'SCN-reminder-recurring-create': needs(
    'F5',
    ['capability-ids'],
    'Recurring-task tools are DB-backed; scripting them needs capability ids.',
  ),
  'SCN-reminder-recurring-manage': needs(
    'F5',
    ['capability-ids'],
    'Recurring-task tools are DB-backed; scripting them needs capability ids.',
  ),
  'SCN-reminder-recurring-fire': needs(
    'F5',
    ['capability-ids', 'scheduler-due-seed'],
    'Seed nextRun in the past and drive the single-pass tick; no production clock seam.',
  ),
  'SCN-deferred-schedule-create': needs(
    'F5',
    ['capability-ids'],
    'Deferred-prompt tools are DB-backed; scripting them needs capability ids.',
  ),
  'SCN-deferred-alert-create': needs(
    'F5',
    ['capability-ids'],
    'Deferred-prompt tools are DB-backed; scripting them needs capability ids.',
  ),
  'SCN-deferred-manage': needs(
    'F5',
    ['capability-ids'],
    'Deferred-prompt tools are DB-backed; scripting them needs capability ids.',
  ),
  'SCN-deferred-fire-scheduled': needs(
    'F5',
    ['capability-ids', 'scheduler-due-seed'],
    'Seed fireAt in the past and drive pollScheduledOnce; proactive replies are captured by the scenario chat.',
  ),
  'SCN-deferred-fire-alert': needs(
    'F5',
    ['capability-ids', 'scheduler-due-seed'],
    'Seed fireAt in the past and drive pollAlertsOnce against the memory task provider.',
  ),
  // F6 — public web fetch
  'SCN-web-fetch': needs(
    'F6',
    ['capability-ids', 'public-url-assertion'],
    'assertPublicUrl performs a real DNS lookup the I/O guard cannot intercept; success path needs the seam.',
  ),
  'SCN-web-fetch-rate-limit-deny': needs(
    'F6',
    ['capability-ids', 'public-url-assertion'],
    'Quota deny is seedable via consumeWebFetchQuota; the URL assertion seam is needed for the attempt to reach the quota check.',
  ),
  // F7 — settings MCP administration
  'SCN-settings-admin-mcp-catalog': needs(
    'F7',
    ['fake-mcp-server'],
    'Admin MCP catalog routes need a fake MCP server over the strict dispatcher.',
  ),
  'SCN-settings-admin-mcp-plugin-servers': needs(
    'F7',
    ['fake-mcp-server'],
    'Plugin-MCP server registration needs a fake MCP server over the strict dispatcher.',
  ),
  // F8 — platform interactions
  'SCN-interaction-discord-router-wrapped': needs(
    'F8',
    ['platform-adapter-fakes'],
    'Wire-level discord.js routing needs a fake Discord client; stays forward-only until the refactor touches chat adapters.',
  ),
  'SCN-interaction-discord-standalone-fallback': needs(
    'F8',
    ['platform-adapter-fakes'],
    'Wire-level discord.js fallback routing needs a fake Discord client; stays forward-only.',
  ),
  'SCN-interaction-telegram-callback': needs(
    'F8',
    ['platform-adapter-fakes'],
    'Wire-level grammY callback wiring needs a fake Telegram API; stays forward-only.',
  ),
  'SCN-interaction-permission-decision': ready(
    'F8',
    'Permission roundtrips already run via when.interaction in the ACP control stories; promoted from forward-only to confirmed.',
  ),
  // Unqueued — no production implementation exists
  'SCN-coding-nerv-create': blocked(
    'unqueued',
    'nerv has no production implementation; revisit when the nerv module lands.',
  ),
  'SCN-coding-nerv-create-conflict': blocked(
    'unqueued',
    'nerv has no production implementation; revisit when the nerv module lands.',
  ),
  'SCN-coding-nerv-create-not-configured': blocked(
    'unqueued',
    'nerv has no production implementation; revisit when the nerv module lands.',
  ),
  'SCN-coding-nerv-whomayuse-denied': blocked(
    'unqueued',
    'nerv has no production implementation; revisit when the nerv module lands.',
  ),
  'SCN-coding-nerv-status': blocked(
    'unqueued',
    'nerv has no production implementation; revisit when the nerv module lands.',
  ),
  'SCN-coding-nerv-list': blocked(
    'unqueued',
    'nerv has no production implementation; revisit when the nerv module lands.',
  ),
  'SCN-coding-nerv-followup': blocked(
    'unqueued',
    'nerv has no production implementation; revisit when the nerv module lands.',
  ),
  'SCN-coding-nerv-steer': blocked('unqueued', 'nerv has no production implementation; keeps gap status.'),
  'SCN-coding-nerv-cancel': blocked(
    'unqueued',
    'nerv has no production implementation; revisit when the nerv module lands.',
  ),
  'SCN-supervise-reconcile-sweep': blocked(
    'unqueued',
    'Supervision has no production implementation; revisit when it lands.',
  ),
  'SCN-supervise-magi-notify-reconcile': blocked(
    'unqueued',
    'Supervision has no production implementation; revisit when it lands.',
  ),
  'SCN-supervise-fleet-health': blocked(
    'unqueued',
    'Supervision has no production implementation; revisit when it lands.',
  ),
  'SCN-supervise-status-sync': blocked(
    'unqueued',
    'Supervision has no production implementation; revisit when it lands.',
  ),
  'SCN-supervise-stale-task': blocked(
    'unqueued',
    'Supervision has no production implementation; revisit when it lands.',
  ),
  'SCN-supervise-stale-review-notify': blocked(
    'unqueued',
    'Supervision has no production implementation; revisit when it lands.',
  ),
  'SCN-supervise-pipeline-failure': blocked(
    'unqueued',
    'Supervision has no production implementation; revisit when it lands.',
  ),
  'SCN-supervise-review-comment': blocked(
    'unqueued',
    'Supervision has no production implementation; revisit when it lands.',
  ),
  'SCN-supervise-mr-merged': blocked(
    'unqueued',
    'Supervision has no production implementation; revisit when it lands.',
  ),
  'SCN-supervise-self-review': blocked('unqueued', 'Supervision has no production implementation; keeps gap status.'),
  'SCN-coding-nerv-forge-event-source': blocked(
    'unqueued',
    'Contract-only non-trigger; no executable story is expected, and nerv has no production implementation.',
  ),
}

export const catalogCoverage: readonly CatalogCoverage[] = Object.freeze(
  CATALOG_SCENARIO_IDS.map((scenarioId) => {
    const mapping = EXECUTABLE_STORY_MAPPINGS[scenarioId]
    if (mapping !== undefined) {
      return Object.freeze({
        scenarioId,
        catalogStatus: catalogStatusFor(scenarioId),
        kind: 'executable' as const,
        verifiedAt: mapping.verifiedAt,
        storyIds: mapping.storyIds,
      })
    }
    const catalogStatus = catalogStatusFor(scenarioId)
    const pendingAudit = AUDIT_RECORDS[scenarioId]
    if (pendingAudit === undefined) throw new Error(`Missing audit record for pending catalog scenario: ${scenarioId}`)
    return Object.freeze({
      scenarioId,
      catalogStatus,
      kind: 'pending' as const,
      verifiedAt: '2026-07-19' as const,
      audit: pendingAudit,
    })
  }),
)
