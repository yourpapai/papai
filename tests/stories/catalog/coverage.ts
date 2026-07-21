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
  'scheduler-chat-di',
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
  'SCN-task-create-update': {
    verifiedAt: '2026-07-19',
    storyIds: [
      'tests/stories/tasks/lifecycle-and-policy.story.test.ts#SCN-task-create-update: creates and renames a task through the tool loop',
    ],
  },
  'SCN-task-query': {
    verifiedAt: '2026-07-19',
    storyIds: [
      'tests/stories/tasks/lifecycle-and-policy.story.test.ts#SCN-task-query: counts and lists tasks with project filters',
    ],
  },
  'SCN-task-delete': {
    verifiedAt: '2026-07-19',
    storyIds: [
      'tests/stories/tasks/lifecycle-and-policy.story.test.ts#SCN-task-delete: deletes with confidence and refuses without it',
    ],
  },
  'SCN-task-history': {
    verifiedAt: '2026-07-19',
    storyIds: [
      'tests/stories/tasks/lifecycle-and-policy.story.test.ts#SCN-task-history: reads self-seeded task activities',
    ],
  },
  'SCN-task-comments': {
    verifiedAt: '2026-07-19',
    storyIds: [
      'tests/stories/tasks/lifecycle-and-policy.story.test.ts#SCN-task-comments: adds, edits, and removes a comment',
    ],
  },
  'SCN-task-labels': {
    verifiedAt: '2026-07-19',
    storyIds: [
      'tests/stories/tasks/lifecycle-and-policy.story.test.ts#SCN-task-labels: creates and assigns a label by name',
    ],
  },
  'SCN-task-not-configured': {
    verifiedAt: '2026-07-19',
    storyIds: [
      'tests/stories/tasks/lifecycle-and-policy.story.test.ts#SCN-task-not-configured: refuses task work without an assigned provider',
    ],
  },
  'SCN-task-ask-confirm': {
    verifiedAt: '2026-07-19',
    storyIds: [
      'tests/stories/tasks/lifecycle-and-policy.story.test.ts#SCN-task-ask-confirm: ask permission gates a mutating task tool',
    ],
  },
  'SCN-task-deny': {
    verifiedAt: '2026-07-19',
    storyIds: [
      'tests/stories/tasks/lifecycle-and-policy.story.test.ts#SCN-task-deny: denied tools leave the advertised toolset',
    ],
  },
  'SCN-task-relations': {
    verifiedAt: '2026-07-19',
    storyIds: [
      'tests/stories/tasks/provider-surface.story.test.ts#SCN-task-relations: links, retypes, and unlinks tasks',
    ],
  },
  'SCN-task-statuses': {
    verifiedAt: '2026-07-19',
    storyIds: [
      'tests/stories/tasks/provider-surface.story.test.ts#SCN-task-statuses: confirms shared status mutations',
    ],
  },
  'SCN-task-projects': {
    verifiedAt: '2026-07-19',
    storyIds: ['tests/stories/tasks/provider-surface.story.test.ts#SCN-task-projects: manages the project catalogue'],
  },
  'SCN-task-project-team': {
    verifiedAt: '2026-07-19',
    storyIds: ['tests/stories/tasks/provider-surface.story.test.ts#SCN-task-project-team: manages project membership'],
  },
  'SCN-task-worklog': {
    verifiedAt: '2026-07-19',
    storyIds: ['tests/stories/tasks/provider-surface.story.test.ts#SCN-task-worklog: logs and edits work items'],
  },
  'SCN-task-sprints': {
    verifiedAt: '2026-07-19',
    storyIds: ['tests/stories/tasks/provider-surface.story.test.ts#SCN-task-sprints: plans work on an agile board'],
  },
  'SCN-task-saved-queries': {
    verifiedAt: '2026-07-19',
    storyIds: [
      'tests/stories/tasks/provider-surface.story.test.ts#SCN-task-saved-queries: lists and runs saved queries',
    ],
  },
  'SCN-task-collaboration': {
    verifiedAt: '2026-07-19',
    storyIds: [
      'tests/stories/tasks/integration-surface.story.test.ts#SCN-task-collaboration: manages watchers, votes, and visibility',
    ],
  },
  'SCN-task-identity': {
    verifiedAt: '2026-07-19',
    storyIds: [
      'tests/stories/tasks/integration-surface.story.test.ts#SCN-task-identity: finds users and provisions members on group turns',
    ],
  },
  'SCN-task-attachments': {
    verifiedAt: '2026-07-19',
    storyIds: [
      'tests/stories/tasks/integration-surface.story.test.ts#SCN-task-attachments: uploads from the relay and removes attachments',
    ],
  },
  'SCN-task-youtrack-command': {
    verifiedAt: '2026-07-19',
    storyIds: [
      'tests/stories/tasks/integration-surface.story.test.ts#SCN-task-youtrack-command: applies a YouTrack command to one task only',
    ],
  },
  'SCN-memo-save': {
    verifiedAt: '2026-07-20',
    storyIds: [
      'tests/stories/memory/memos.story.test.ts#SCN-memo-save: saves a note and reads it back on a later turn',
    ],
  },
  'SCN-memo-recall': {
    verifiedAt: '2026-07-20',
    storyIds: ['tests/stories/memory/memos.story.test.ts#SCN-memo-recall: recalls a saved note by semantic search'],
  },
  'SCN-memo-archive': {
    verifiedAt: '2026-07-20',
    storyIds: [
      'tests/stories/memory/memos.story.test.ts#SCN-memo-archive: archives notes by id and excludes them from active list',
    ],
  },
  'SCN-memo-promote': {
    verifiedAt: '2026-07-20',
    storyIds: ['tests/stories/memory/memos.story.test.ts#SCN-memo-promote: promotes a note into a task'],
  },
  'SCN-memory-remember': {
    verifiedAt: '2026-07-20',
    storyIds: ['tests/stories/memory/memory.story.test.ts#SCN-memory-remember: stores a durable memory and lists it'],
  },
  'SCN-memory-recall': {
    verifiedAt: '2026-07-20',
    storyIds: ['tests/stories/memory/memory.story.test.ts#SCN-memory-recall: recalls a stored memory by keyword'],
  },
  'SCN-memory-forget': {
    verifiedAt: '2026-07-20',
    storyIds: ['tests/stories/memory/memory.story.test.ts#SCN-memory-forget: forgets a stored memory by query'],
  },
  'SCN-memory-capture-sweep': {
    verifiedAt: '2026-07-20',
    storyIds: [
      'tests/stories/memory/memory.story.test.ts#SCN-memory-capture-sweep: captures a memory from an idle group thread',
    ],
  },
  'SCN-memory-promotion-sweep': {
    verifiedAt: '2026-07-20',
    storyIds: [
      'tests/stories/memory/memory.story.test.ts#SCN-memory-promotion-sweep: promotes a cross-thread provisional cluster to durable',
    ],
  },
  'SCN-instructions-save': {
    verifiedAt: '2026-07-20',
    storyIds: [
      'tests/stories/memory/instructions.story.test.ts#SCN-instructions-save: saves a custom instruction and lists it',
    ],
  },
  'SCN-instructions-list-delete': {
    verifiedAt: '2026-07-20',
    storyIds: [
      'tests/stories/memory/instructions.story.test.ts#SCN-instructions-list-delete: deletes an instruction and confirms it is gone from a later list',
    ],
  },
  'SCN-history-lookup': {
    verifiedAt: '2026-07-20',
    storyIds: [
      'tests/stories/context/history-lookup.story.test.ts#SCN-history-lookup: searches the main group history from a thread',
    ],
  },
  'SCN-http-auth-claim': {
    verifiedAt: '2026-07-20',
    storyIds: [
      'tests/stories/http/auth-claim.story.test.ts#SCN-http-auth-claim: a single-use code exchanges for a session that authorizes reads',
    ],
  },
  'SCN-http-admin-dashboard': {
    verifiedAt: '2026-07-20',
    storyIds: [
      'tests/stories/http/dashboard.story.test.ts#SCN-http-admin-dashboard: the dashboard session authorizes admin reads that reject anonymous callers',
    ],
  },
  'SCN-http-billing-stats-readonly': {
    verifiedAt: '2026-07-20',
    storyIds: [
      'tests/stories/http/dashboard.story.test.ts#SCN-http-billing-stats-readonly: the dashboard session reads stats that reject anonymous callers',
    ],
  },
  'SCN-http-debug-live-panels': {
    verifiedAt: '2026-07-20',
    storyIds: [
      'tests/stories/http/dashboard.story.test.ts#SCN-http-debug-live-panels: debug panels require both the world flag and the dashboard session',
    ],
  },
  'SCN-http-notify': {
    verifiedAt: '2026-07-20',
    storyIds: [
      'tests/stories/http/notify.story.test.ts#SCN-http-notify: an authorized notify delivers a proactive message',
    ],
  },
  'SCN-http-transcript-viewer': {
    verifiedAt: '2026-07-20',
    storyIds: [
      'tests/stories/http/transcript-viewer.story.test.ts#SCN-http-transcript-viewer: the viewer proxies transcript bytes from magi',
    ],
  },
  'SCN-reminder-recurring-create': {
    verifiedAt: '2026-07-21',
    storyIds: [
      'tests/stories/scheduling/recurring.story.test.ts#SCN-reminder-recurring-create: creating a recurrence persists it for a following list',
    ],
  },
  'SCN-reminder-recurring-manage': {
    verifiedAt: '2026-07-21',
    storyIds: [
      'tests/stories/scheduling/recurring.story.test.ts#SCN-reminder-recurring-manage: pausing a recurrence is observable on a following list',
    ],
  },
  'SCN-reminder-recurring-fire': {
    verifiedAt: '2026-07-21',
    storyIds: [
      'tests/stories/scheduling/recurring.story.test.ts#SCN-reminder-recurring-fire: a due recurrence creates a task and notifies the user',
    ],
  },
  'SCN-deferred-schedule-create': {
    verifiedAt: '2026-07-21',
    storyIds: [
      'tests/stories/scheduling/deferred.story.test.ts#SCN-deferred-schedule-create: scheduling a prompt persists it for a following list',
    ],
  },
  'SCN-deferred-alert-create': {
    verifiedAt: '2026-07-21',
    storyIds: [
      'tests/stories/scheduling/deferred.story.test.ts#SCN-deferred-alert-create: creating a task-condition alert persists it for a following list',
    ],
  },
  'SCN-deferred-manage': {
    verifiedAt: '2026-07-21',
    storyIds: [
      'tests/stories/scheduling/deferred.story.test.ts#SCN-deferred-manage: cancelling a scheduled prompt is observable on a following list',
    ],
  },
  'SCN-deferred-fire-scheduled': {
    verifiedAt: '2026-07-21',
    storyIds: [
      'tests/stories/scheduling/deferred.story.test.ts#SCN-deferred-fire-scheduled: a due scheduled prompt delivers a proactive message',
    ],
  },
  'SCN-deferred-fire-alert': {
    verifiedAt: '2026-07-21',
    storyIds: [
      'tests/stories/scheduling/deferred.story.test.ts#SCN-deferred-fire-alert: an overdue task fires a proactive alert',
    ],
  },
  // F6 — public web fetch
  'SCN-web-fetch': {
    verifiedAt: '2026-07-21',
    storyIds: [
      'tests/stories/web/web-fetch.story.test.ts#SCN-web-fetch: fetching a public page surfaces its content and serves a second turn from cache',
    ],
  },
  // Corrected mechanism (rule 6): quota is enforced in fetch-extract.ts (enforceQuota) BEFORE
  // safeFetchContent, so the deny path never reaches assertPublicUrl — it needs only capability-ids
  // plus the given.exhaustedWebFetchQuota seed, not public-url-assertion.
  'SCN-web-fetch-rate-limit-deny': {
    verifiedAt: '2026-07-21',
    storyIds: [
      'tests/stories/web/web-fetch.story.test.ts#SCN-web-fetch-rate-limit-deny: an exhausted quota denies the fetch with no outbound request',
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
  // F3 — memory, memos, instructions, history, chat links
  'SCN-fetch-chat-link': needs(
    'F3',
    ['capability-ids', 'platform-adapter-fakes'],
    'fetch_chat_link resolves Mattermost permalinks through the authenticated Mattermost REST API (resolveChatLink), never assertPublicUrl (that DNS/SSRF guard is web_fetch, family F6). Needs a Mattermost REST resolver fake, not built speculatively.',
  ),
  // F4 — HTTP surfaces
  'SCN-http-mattermost-action': needs(
    'F4',
    ['mattermost-action-fixture'],
    'Action callbacks bypass the session gate but need the test secret option wired into the world; wire verification stays forward-only.',
  ),
  // F7 — settings MCP administration
  'SCN-http-mcp-plugin': needs(
    'F7',
    ['fake-mcp-server'],
    'The /mcp/plugin route makes papai the MCP server (in-process dispatch to a fixture plugin tool), unlike F7 admin-MCP which needs papai as a client to an external fake MCP server; F7 owns all MCP-harness machinery. Reclassified F4 to F7 (rule 6).',
  ),
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
