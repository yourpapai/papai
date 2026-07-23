<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Story Catalog Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 97 generic "Awaiting branch audit" pending reasons in the story catalog with structured, machine-checked audit records (classification, family, rationale), reclassify `cmd-*` and `interaction-permission-decision`, and map the two context core stories — so coverage expansion runs on data, not opinion.

**Architecture:** `tests/stories/catalog/coverage.ts` gains a typed audit model (`AuditRecord` = readiness × family × rationale, with a typed seam registry) plus one complete `AUDIT_RECORDS` table covering every pending id; the builder throws on a missing record. `catalogStatusFor` drops the blanket `SCN-cmd-` forward-only rule and `SCN-interaction-permission-decision` is promoted to confirmed. Two new catalog ids (`SCN-context-thread-scope`, `SCN-context-group-identity`) map the existing context stories. A `scripts/story/coverage-totals.ts` module prints the coverage tally into runner output.

**Tech Stack:** Bun, TypeScript (strict), bun:test.

**Spec:** `docs/superpowers/specs/2026-07-19-story-coverage-expansion-roadmap-design.md` (Deliverable 1)

**Ledger arithmetic after this plan:** catalog 126 → **128** ids; executable 30 → **32**; pending 97 → **96** (18 `executable-as-is`, 56 `needs-seam`, 22 `blocked:missing-implementation`).

**Snapshot note (post-hoc):** The inline `AUDIT_RECORDS` table (Task 1) and the counts
above are the audit exactly as it landed (2026-07-19); they are **not** maintained as
families execute. The authoritative, machine-checked ledger is
`tests/stories/catalog/coverage.ts` (current: 128 ids / 81 executable / 47 pending). For
the reclassifications since — F1's resolved `cmd-stop-*` pair and dropped
`compaction-trigger`, F2's three-way split, F3's `fetch-chat-link` correction, and F4's
`http-mcp-plugin` → F7 — see "Reclassifications and amendments (F1–F4)" in the roadmap
spec.

**Frozen-tree note:** `tests/stories/**` and `scripts/story/**` are frozen compat inputs — this plan re-baselines the manifest again; record the branch HEAD as the compat baseline after it lands. The 40-story scenario set itself is untouched.

---

### Task 1: Audit model, full audit table, reclassification, context mappings

**Files:**

- Modify: `tests/stories/catalog/coverage.ts` (types, ids, status sets, builder; current length 428 lines — expect ~700 after; the repo's `max-lines` lint may force a split — see Step 4 note)
- Test: `tests/stories/harness/catalog-coverage.test.ts`

- [ ] **Step 1: Write the failing tests**

In `tests/stories/harness/catalog-coverage.test.ts`:

1. In `classifies every catalog scenario exactly once`, change both `126` literals to `128`.
2. Replace the `marks interaction scenarios as forward-only` test with:

```typescript
test('marks only platform-adapter interaction scenarios as forward-only', () => {
  const interactionCoverage = catalogCoverage.filter(({ scenarioId }) => scenarioId.startsWith('SCN-interaction-'))

  expect(interactionCoverage).toHaveLength(4)
  expect(interactionCoverage.map(({ catalogStatus }) => catalogStatus)).toEqual([
    'forward-only',
    'forward-only',
    'forward-only',
    'confirmed',
  ])
})
```

3. In `tracks the executable coverage total` (added by the hygiene batch), change `30` to `32`.
4. In `keeps pending reasons and executable references accountable to local literal stories`, change the pending loop from `coverage.reason.toString()` to `coverage.audit.rationale.toString()` (the rest of the test is unchanged).
5. Add these new tests inside the same describe block. The repo lints `vitest/no-conditional-tests`/`no-conditional-expect`, so every derivation below uses single-predicate filters only — no `if`, ternary, or `&&` inside test bodies (a top-level helper is fine):

```typescript
test('promotes command scenarios from blanket forward-only to confirmed', () => {
  const commandCoverage = catalogCoverage.filter(({ scenarioId }) => scenarioId.startsWith('SCN-cmd-'))

  expect(commandCoverage).toHaveLength(16)
  const statuses = commandCoverage.map(({ catalogStatus }) => catalogStatus)
  expect(statuses.filter((status) => status === 'confirmed')).toHaveLength(15)
  expect(commandCoverage.find(({ scenarioId }) => scenarioId === 'SCN-cmd-announce')?.catalogStatus).toBe('gap')
})

test('maps the context core stories to their catalog records', () => {
  expect(catalogCoverage.find(({ scenarioId }) => scenarioId === 'SCN-context-thread-scope')).toEqual({
    scenarioId: 'SCN-context-thread-scope',
    catalogStatus: 'confirmed',
    kind: 'executable',
    verifiedAt: '2026-07-19',
    storyIds: [
      'tests/stories/context/thread-scope.story.test.ts#group threads share config but isolate conversation history',
    ],
  })
  expect(catalogCoverage.find(({ scenarioId }) => scenarioId === 'SCN-context-group-identity')).toEqual({
    scenarioId: 'SCN-context-group-identity',
    catalogStatus: 'confirmed',
    kind: 'executable',
    verifiedAt: '2026-07-19',
    storyIds: [
      'tests/stories/context/group-users.story.test.ts#group members share durable config while retaining distinct identities',
    ],
  })
})

test('audit records cover exactly the pending scenarios', () => {
  const pendingIds = pendingCoverage.map(({ scenarioId }) => scenarioId)

  expect(pendingIds).toHaveLength(96)
  expect(sorted(Object.keys(AUDIT_RECORDS))).toEqual(sorted(pendingIds))
})

test('records a non-blank rationale and a known family for every pending scenario', () => {
  const blankRationales = pendingCoverage
    .filter((coverage) => coverage.audit.rationale.toString().trim().length === 0)
    .map(({ scenarioId }) => scenarioId)
  const unknownFamilies = pendingCoverage
    .filter((coverage) => !STORY_FAMILIES.includes(coverage.audit.family))
    .map(({ scenarioId }) => scenarioId)

  expect(blankRationales).toEqual([])
  expect(unknownFamilies).toEqual([])
})

test('references only known seams', () => {
  const unknownSeams = pendingCoverage.flatMap((coverage) =>
    auditSeams(coverage)
      .filter((seam) => !STORY_SEAM_IDS.includes(seam))
      .map((seam) => `${coverage.scenarioId} -> ${seam}`),
  )

  expect(unknownSeams).toEqual([])
})

test('audit readiness totals match the audit outcome', () => {
  const states = pendingCoverage.map((coverage) => coverage.audit.readiness.state)

  expect(states.filter((state) => state === 'executable-as-is')).toHaveLength(18)
  expect(states.filter((state) => state === 'needs-seam')).toHaveLength(56)
  expect(states.filter((state) => state === 'blocked')).toHaveLength(22)
})

test('assigns every pending scenario to its family queue', () => {
  const expectations: ReadonlyArray<readonly [string, StoryFamily]> = [
    ['SCN-meta-', 'F1'],
    ['SCN-cmd-', 'F1'],
    ['SCN-task-', 'F2'],
    ['SCN-memory-', 'F3'],
    ['SCN-memo-', 'F3'],
    ['SCN-instructions-', 'F3'],
    ['SCN-history-', 'F3'],
    ['SCN-fetch-', 'F3'],
    ['SCN-http-', 'F4'],
    ['SCN-deferred-', 'F5'],
    ['SCN-reminder-', 'F5'],
    ['SCN-web-fetch-', 'F6'],
    ['SCN-settings-admin-mcp-', 'F7'],
    ['SCN-interaction-', 'F8'],
    ['SCN-coding-nerv-', 'unqueued'],
    ['SCN-supervise-', 'unqueued'],
  ]
  const mismatches = pendingCoverage.flatMap((coverage) => {
    const expectation = expectations.find(([prefix]) => coverage.scenarioId.startsWith(prefix))
    return expectation === undefined || coverage.audit.family !== expectation[1] ? [coverage.scenarioId] : []
  })

  expect(mismatches).toEqual([])
})
```

And at the top level of the test file (outside any describe — conditionals are lint-safe here), add:

```typescript
const pendingCoverage = catalogCoverage.filter((coverage) => coverage.kind === 'pending')

const auditSeams = (coverage: (typeof catalogCoverage)[number]): readonly string[] =>
  coverage.kind === 'pending' && coverage.audit.readiness.state === 'needs-seam' ? coverage.audit.readiness.seams : []
```

(The `mismatches` ternary lives inside a test body but is a data derivation, not a conditional test or expect — the same pattern the pre-existing `missingFromRegistry` derivations use in `tests/chat/context-scope-consistency.test.ts`. If lint still flags it, hoist the whole derivation to a top-level `const mismatches = ...` and keep only the `expect(mismatches).toEqual([])` in the test.)

6. Update the test file's coverage import to include the new names:

```typescript
import {
  AUDIT_RECORDS,
  CATALOG_SCENARIO_IDS,
  catalogCoverage,
  STORY_FAMILIES,
  STORY_SEAM_IDS,
  toPendingReason,
  type StoryFamily,
} from '../catalog/coverage.js'
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test --path-ignore-patterns '' tests/stories/harness/catalog-coverage.test.ts`
Expected: FAIL — `AUDIT_RECORDS`/`STORY_FAMILIES`/`STORY_SEAM_IDS` are not exported, counts mismatch (126/30/97), `coverage.reason` no longer type-checks once the model lands.

- [ ] **Step 3: Add the two context ids to the catalog and the executable mappings**

In `tests/stories/catalog/coverage.ts`, append to `CATALOG_SCENARIO_IDS` (before the closing `] as const`):

```typescript
  'SCN-context-thread-scope',
  'SCN-context-group-identity',
```

Append to `EXECUTABLE_STORY_MAPPINGS`:

```typescript
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
```

- [ ] **Step 4: Add the audit model types**

In `coverage.ts`, after the `NonEmptyReadonlyTuple` definition, add:

```typescript
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
```

Change the pending arm of `CatalogCoverage` to:

```typescript
  | Readonly<{
      scenarioId: CatalogScenarioId
      catalogStatus: CatalogStatus
      kind: 'pending'
      verifiedAt: string
      audit: AuditRecord
    }>
```

**File-size note:** `coverage.ts` will grow to ~700 lines. If `bun run lint` reports `max-lines`, split mechanically: move the audit model (Step 4 types) and the `AUDIT_RECORDS` table (Step 6) into `tests/stories/catalog/audit.ts`, import them into `coverage.ts`, and re-export (`export { AUDIT_RECORDS, STORY_FAMILIES, STORY_SEAM_IDS } from './audit.js'` plus `export type { AuditReadiness, AuditRecord, StoryFamily, StorySeamId } from './audit.js'`) so the test file's imports from `../catalog/coverage.js` keep working. Do not suppress the lint rule.

- [ ] **Step 5: Reclassify the status sets**

In `coverage.ts`:

1. Remove `'SCN-interaction-permission-decision'` from `FORWARD_ONLY_SCENARIO_IDS` (leaving 6 entries: the 2 ACP-denied ids, 2 Discord ids, telegram-callback, mattermost-action).
2. In `catalogStatusFor`, remove the `|| scenarioId.startsWith('SCN-cmd-')` clause so cmd ids classify by the set alone. `SCN-cmd-announce` stays `gap` via `GAP_SCENARIO_IDS`.

- [ ] **Step 6: Write the complete audit table**

Replace `REQUIRED_SEAMS` and `pendingReasonFor` with the `auditRecord` helper, three terse entry helpers, and the full `AUDIT_RECORDS` table. Delete `REQUIRED_SEAMS` and `pendingReasonFor` entirely (no external consumers — verified). (`executableStoryIdsFor` no longer exists — the hygiene batch removed it.)

```typescript
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
  'SCN-meta-expand-result': needs(
    'F1',
    ['compaction-trigger'],
    'Result compaction engages only above COMPACTION_THRESHOLD_BYTES; a memory-provider knob must return an oversized payload deterministically.',
  ),
  'SCN-meta-search-tools': needs(
    'F1',
    ['capability-ids'],
    'Scripting search_tools needs a capability id; ranking assertions rely on the lexical fallback when embeddings are unavailable.',
  ),
  'SCN-meta-load-tool': ready(
    'F1',
    'autoLoadTools already emits load_tool for non-advertised capabilities; assertions read the model available-tools inspections.',
  ),
  'SCN-cmd-help': ready(
    'F1',
    'Behavioral /help flow runs through the real registered handler via scenario chat dispatch; menu registration stays with adapter contract tests.',
  ),
  'SCN-cmd-start': ready(
    'F1',
    'Real /start onboarding reply via scenario chat dispatch; menu registration stays with adapter contract tests.',
  ),
  'SCN-cmd-config-dm': ready(
    'F1',
    'DM /config issues a real settings auth code through the registered handler; link semantics are behavioral, menu stays adapter-side.',
  ),
  'SCN-cmd-config-group': ready(
    'F1',
    'Group /config scopes the issued settings link; behavioral dispatch works, menu registration stays adapter-side.',
  ),
  'SCN-cmd-context': ready(
    'F1',
    'Real /context reply via scenario chat dispatch; menu registration stays with adapter contract tests.',
  ),
  'SCN-cmd-clear-self': ready(
    'F1',
    'Clear-own-history authorization and effect run through the real handler; menu registration stays adapter-side.',
  ),
  'SCN-cmd-clear-target-user': ready(
    'F1',
    'Clear-other authorization and effect run through the real handler; menu registration stays adapter-side.',
  ),
  'SCN-cmd-clear-all': ready(
    'F1',
    'Clear-all admin authorization and effect run through the real handler; menu registration stays adapter-side.',
  ),
  'SCN-cmd-clear-group-denied': ready(
    'F1',
    'Denied group clear produces the real refusal reply; menu registration stays adapter-side.',
  ),
  'SCN-cmd-dashboard': ready(
    'F1',
    'Dashboard sign-in link issuance runs through the real handler; menu registration stays adapter-side.',
  ),
  'SCN-cmd-stop-noop': ready(
    'F1',
    'Stop with no active turn produces the real no-op reply; no mid-turn seam required.',
  ),
  'SCN-cmd-stop-graceful': needs(
    'F1',
    ['mid-turn-run-control'],
    'Stopping mid-turn needs a blocking scripted-LLM decision or a stop between queued generations; the model cannot block today.',
  ),
  'SCN-cmd-stop-abort': needs(
    'F1',
    ['mid-turn-run-control'],
    'Aborting mid-turn needs the same mid-turn seam as graceful stop; classify together.',
  ),
  'SCN-cmd-acp': ready(
    'F1',
    'Overlaps SCN-coding-acp-command coverage; the F1 spec decides a dedicated story versus mapping the existing command story.',
  ),
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
```

- [ ] **Step 7: Rewire the pending branch of the builder**

In `coverage.ts`, replace the pending branch of the `catalogCoverage` map with:

```typescript
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
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `bun test --path-ignore-patterns '' tests/stories/harness/catalog-coverage.test.ts`
Expected: all PASS, including the pre-existing ACP/settings/guest-readonly mapping tests.

- [ ] **Step 9: Run lint and typecheck (watch for the max-lines split note in Step 4)**

Run: `bun run typecheck && bun run lint`
Expected: clean. If `max-lines` fires on `coverage.ts`, perform the mechanical split described in Step 4 and re-run.

- [ ] **Step 10: Commit**

```bash
git add tests/stories/catalog/ tests/stories/harness/catalog-coverage.test.ts
git commit -m "test(stories): audit every pending catalog scenario with structured records"
```

---

### Task 2: Coverage totals in runner output

**Files:**

- Create: `scripts/story/coverage-totals.ts`
- Modify: `scripts/story/test-stories.ts` (`verifyCompatibility`, after the manifest write)
- Test: `tests/scripts/story-coverage-totals.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `tests/scripts/story-coverage-totals.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { formatStoryCoverageTotals, storyCoverageTotals } from '../../scripts/story/coverage-totals.js'

describe('storyCoverageTotals', () => {
  test('tallies the catalog ledger', () => {
    expect(storyCoverageTotals()).toEqual({
      total: 128,
      executable: 32,
      pending: 96,
      readiness: { 'executable-as-is': 18, 'needs-seam': 56, blocked: 22 },
    })
  })

  test('formats a single summary line', () => {
    expect(formatStoryCoverageTotals()).toBe(
      'story catalog: 32/128 executable; pending 96 (18 executable-as-is, 56 needs-seam, 22 blocked)',
    )
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/scripts/story-coverage-totals.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the totals module**

Create `scripts/story/coverage-totals.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { catalogCoverage } from '../../tests/stories/catalog/coverage.js'

export type StoryCoverageTotals = Readonly<{
  total: number
  executable: number
  pending: number
  readiness: Readonly<{ 'executable-as-is': number; 'needs-seam': number; blocked: number }>
}>

export function storyCoverageTotals(): StoryCoverageTotals {
  const readiness = { 'executable-as-is': 0, 'needs-seam': 0, blocked: 0 }
  let executable = 0
  for (const coverage of catalogCoverage) {
    if (coverage.kind === 'executable') executable += 1
    else readiness[coverage.audit.readiness.state] += 1
  }
  return {
    total: catalogCoverage.length,
    executable,
    pending: catalogCoverage.length - executable,
    readiness,
  }
}

export function formatStoryCoverageTotals(totals: StoryCoverageTotals = storyCoverageTotals()): string {
  return `story catalog: ${totals.executable}/${totals.total} executable; pending ${totals.pending} (${totals.readiness['executable-as-is']} executable-as-is, ${totals.readiness['needs-seam']} needs-seam, ${totals.readiness.blocked} blocked)`
}
```

- [ ] **Step 4: Print the tally from the runner**

`RunnerDependencies` has no logging channel (`scripts/story/test-stories.ts:26-50`) and the module already calls `console.error` directly (`test-stories.ts:139`), so use `console.log` — do not add a DI seam. In `scripts/story/test-stories.ts`, inside `verifyCompatibility`, immediately after `await dependencies.writeManifest(candidateManifest, ...)`, add:

```typescript
console.log(formatStoryCoverageTotals())
```

Add the import: `import { formatStoryCoverageTotals } from './coverage-totals.js'`. This placement covers both `--manifest-only` and full runs (both call `verifyCompatibility`).

- [ ] **Step 5: Run the test and the runner to verify**

Run: `bun test tests/scripts/story-coverage-totals.test.ts` — PASS.
Run: `bun test:stories:manifest 2>&1 | grep "story catalog"` — expected output line: `story catalog: 32/128 executable; pending 96 (18 executable-as-is, 56 needs-seam, 22 blocked)`.
Run: `bun test tests/scripts/` — all pass (no existing suite regresses).

- [ ] **Step 6: Commit**

```bash
git add scripts/story/coverage-totals.ts scripts/story/test-stories.ts tests/scripts/story-coverage-totals.test.ts
git commit -m "test(stories): print catalog coverage totals in runner output"
```

---

### Task 3: Final verification gate

- [ ] **Step 1: Sandboxed story suite — scenario set unchanged**

Run: `bun test:stories`
Expected: 40 pass / 0 fail (the audit touches the ledger, not the stories).

- [ ] **Step 2: Sandboxed contract suites**

Run: `bun test:stories:contracts`
Expected: all pass (253 hygiene-era tests plus the new catalog tests).

- [ ] **Step 3: Runner unit suites**

Run: `bun test tests/scripts/`
Expected: all pass.

- [ ] **Step 4: Typecheck and lint**

Run: `bun run typecheck && bun run lint`
Expected: clean.

- [ ] **Step 5: Fresh manifest and compat check**

Run: `bun test:stories:manifest`, confirm the output line `story catalog: 32/128 executable; pending 96 (18 executable-as-is, 56 needs-seam, 22 blocked)` and that the manifest scenario count is still 41.
Run: `git status --short` (clean), then `bun scripts/story/test-stories.ts --compat --baseline-ref HEAD --manifest-only`
Expected: exit 0.
