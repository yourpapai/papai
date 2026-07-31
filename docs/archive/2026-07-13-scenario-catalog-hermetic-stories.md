<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Scenario Catalog Hermetic Stories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the external 126-record scenario catalog an auditable, hermetic Tier 0 story-coverage inventory, with executable happy and unhappy paths for behavior present on this branch and documented pending coverage for the rest.

**Architecture:** Keep each story on the real in-process runtime path (chat/HTTP ingress → authorization and context → scripted LLM or route → production operation → reply/storage). Add only focused fake-provider and scenario API surfaces that represent a real production seam. A repository-local catalog ledger is validated against the existing story-manifest AST extractor, so the test suite never reads the peer-workspace catalog at runtime.

**Tech Stack:** Bun 1.3.x, TypeScript, `bun:test`, existing `ScenarioWorld`, AI SDK scripted model, in-memory SQLite, strict HTTP dispatcher, fake Magi, `TaskProvider` test double.

**Design:** `docs/superpowers/specs/2026-07-13-scenario-catalog-hermetic-stories-design.md`

---

## Planning unit

**Objective:** Prove user-visible catalog behavior across chat, settings, HTTP, ACP, and available background paths without live infrastructure.

**Regression boundary:** Existing Tier 0 stories, manifest compatibility, strict I/O rules, provider-real E2E ownership, and current production wire-tool names must remain unchanged.

**Audience:** papai maintainers reviewing runtime refactors and feature owners deciding which catalog records are still pending.

**Realism tier:** Tier 0 hermetic full-stack stories. Provider HTTP behavior remains Tier 1 (`bun test:e2e`); platform-adapter parity remains separate platform integration coverage.

**Excluded from executable stories:** catalog `gap` and `contract-only` records; records absent from this branch; peer-service supervisor flows with no current papai ingress or hermetic protocol seam. These are pending ledger entries, never skipped tests.

## Runtime paths and fixtures

```text
Chat story:
fake incoming message / interaction
  -> ChatRouter and authorization
  -> context scope and capability assembly
  -> ScriptedModel tool loop
  -> production tool / TaskProvider / store / strict HTTP fake
  -> fake chat reply and sanitized ScenarioEvents

Settings or HTTP story:
fake Request
  -> PapaiRuntime.request / routeRequest
  -> session + CSRF or endpoint authentication
  -> production route + SQLite store / strict HTTP fake
  -> Response, persisted state, and no-forbidden-side-effect assertion
```

Every story creates its own world. Use `given` only before runtime startup, `when` only for ingress, and `then` plus `world.events`/store reads for assertions. Use `world.clock.advance()` and `world.settle()` rather than timers or sleeps. Seed only the user, context, task instance, provider objects, settings session, and strict HTTP expectations a scenario needs.

## Scenario destination matrix

The ledger contains one entry per ID. These destination groups are the source of truth for implementation; a status change during the branch audit updates the ledger entry, not the catalog.

| Destination                                                | Catalog IDs                                                                                                                                                                              | Happy and safety oracle                                                                              |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `chat-task/core.story.test.ts`                             | `SCN-task-create-update`, `SCN-task-query`, `SCN-task-delete`, `SCN-task-not-configured`                                                                                                 | mutation/query reply and event; confirmation/no-provider branch has no mutation                      |
| `chat-task/collaboration.story.test.ts`                    | `SCN-task-history`, `SCN-task-comments`, `SCN-task-labels`, `SCN-task-relations`, `SCN-task-collaboration`, `SCN-task-identity`                                                          | provider state/event; unsupported or guest write is not advertised and does not mutate               |
| `chat-task/workflow.story.test.ts`                         | `SCN-task-statuses`, `SCN-task-projects`, `SCN-task-project-team`, `SCN-task-worklog`, `SCN-task-sprints`, `SCN-task-saved-queries`, `SCN-task-attachments`, `SCN-task-youtrack-command` | configured provider operation; confirm/unsupported/error branch leaves state unchanged               |
| `context/policy.story.test.ts`                             | `SCN-task-guest-readonly`, `SCN-task-ask-confirm`, `SCN-task-deny`, `SCN-coding-acp-whomayuse-denied`, `SCN-coding-acp-guest-denied`, `SCN-coding-nerv-whomayuse-denied`                 | offered-tool set and interaction result; hidden tool is never called                                 |
| `assistant/*.story.test.ts`                                | `SCN-memo-*`, `SCN-reminder-recurring-*`, `SCN-deferred-*`, `SCN-memory-*`, `SCN-web-fetch*`, `SCN-fetch-chat-link`, `SCN-instructions-*`, `SCN-history-lookup`, `SCN-meta-*`            | persisted/proactive reply and event; quota, auth, unsupported, and idempotency branches              |
| `commands/*.story.test.ts`, `interactions/*.story.test.ts` | all `SCN-cmd-*`, `SCN-interaction-*`                                                                                                                                                     | command/callback output; role, context, and second-action safety branch                              |
| `settings/*.story.test.ts`, `http/*.story.test.ts`         | all `SCN-settings-*`, `SCN-http-*`                                                                                                                                                       | route response + store/network event; unauthenticated, CSRF, malformed, and forbidden request branch |
| `integrations/coding-sessions/*.story.test.ts`             | all `SCN-coding-acp-*`                                                                                                                                                                   | fake-Magi request + persisted session/reply; policy/config/upstream failure has no session mutation  |
| ledger pending                                             | all current `SCN-coding-nerv-*`, `SCN-supervise-*`, `SCN-http-transcript-viewer`, `SCN-cmd-announce`, plus any audited-absent record                                                     | exact reason, branch evidence, and required future seam; no executable story                         |

The implementation audit must not assume that `confirmed` means currently reachable. A record becomes `executable` only after the actual branch path and required hermetic fake are verified.

## File structure

- Create `tests/stories/catalog/coverage.ts` — immutable catalog snapshot ID list, source fingerprint, classification types, and entries.
- Create `tests/stories/harness/catalog-coverage.test.ts` — contract tests using `loadCandidateStoryFiles()` and `extractStoryScenarios()`.
- Modify `tests/stories/harness/memory-task-provider.ts` — deterministic optional `TaskProvider` capability families and sanitized events.
- Modify `tests/stories/harness/fixtures.ts`, `tests/stories/harness/world.ts`, `tests/stories/harness/scenario.ts` — only typed fixtures/assertions required by executable stories.
- Create `tests/stories/chat-task/{core,collaboration,workflow}.story.test.ts` and `tests/stories/context/policy.story.test.ts`.
- Create `tests/stories/assistant/{memos-recurring,deferred-memory,web-instructions-meta}.story.test.ts`.
- Create `tests/stories/{commands,interactions}/*.story.test.ts`.
- Create `tests/stories/settings/{auth-context,coding-admin}.story.test.ts` and `tests/stories/http/{notify-mcp,operator-surfaces}.story.test.ts`.
- Create `tests/stories/integrations/coding-sessions/{lifecycle,policy}.story.test.ts`; extend `tests/stories/harness/fake-magi.ts` only for verified Magi endpoints.
- Modify `docs/superpowers/specs/2026-07-13-scenario-catalog-hermetic-stories-design.md` only if audit evidence changes an approved boundary; otherwise update only the ledger.

## Tasks

### Task 1: Add the catalog ledger and executable-reference contract

**Files:**

- Create: `tests/stories/catalog/coverage.ts`
- Create: `tests/stories/harness/catalog-coverage.test.ts`
- Test: `tests/stories/harness/catalog-coverage.test.ts`

- [ ] **Step 1: Write the failing ledger contract**

Create the harness test with the following imports and first invariant. Keep it under `harness/` because `bun test:stories:contracts` discovers only that directory.

```typescript
import { expect, test } from 'bun:test'

import { loadCandidateStoryFiles } from '../../../scripts/story-manifest-candidate.js'
import { extractStoryScenarios } from '../../../scripts/story-manifest-scenarios.js'
import { CATALOG_SCENARIO_IDS, catalogCoverage } from '../catalog/coverage.js'

async function declaredScenarioIds(): Promise<ReadonlySet<string>> {
  const files = await loadCandidateStoryFiles(process.cwd())
  return new Set(files.flatMap(({ path, bytes }) => extractStoryScenarios(path, bytes).map(({ id }) => id)))
}

test('classifies every catalog record exactly once', () => {
  expect(CATALOG_SCENARIO_IDS).toHaveLength(126)
  expect(new Set(CATALOG_SCENARIO_IDS).size).toBe(126)
  expect(catalogCoverage.map(({ scenarioId }) => scenarioId).sort()).toEqual([...CATALOG_SCENARIO_IDS].sort())
})

test('references declared literal stories and explains every pending record', async () => {
  const declared = await declaredScenarioIds()
  for (const entry of catalogCoverage) {
    if (entry.kind === 'pending') {
      expect(entry.reason.trim().length).toBeGreaterThan(0)
      continue
    }
    expect(entry.storyIds.length).toBeGreaterThan(0)
    for (const storyId of entry.storyIds) expect(declared.has(storyId)).toBe(true)
  }
})
```

- [ ] **Step 2: Run the contract and verify RED**

Run:

```bash
bun test tests/stories/harness/catalog-coverage.test.ts
```

Expected: FAIL because `tests/stories/catalog/coverage.ts` does not exist.

- [ ] **Step 3: Implement the local snapshot types and full inventory**

Create `coverage.ts` with a discriminated union that makes an unreasoned pending entry impossible:

```typescript
export type CatalogStatus = 'confirmed' | 'forward-only' | 'gap' | 'contract-only'
type ExecutableCoverage = Readonly<{
  scenarioId: string
  catalogStatus: CatalogStatus
  kind: 'executable'
  verifiedAt: string
  storyIds: readonly string[]
}>
type PendingCoverage = Readonly<{
  scenarioId: string
  catalogStatus: CatalogStatus
  kind: 'pending'
  verifiedAt: string
  reason: string
  requiredSeam?: string
}>
export type CatalogCoverage = ExecutableCoverage | PendingCoverage
```

Populate `CATALOG_SCENARIO_IDS` with the 126 literal IDs from the 2026-07-13 catalog audit, in catalog order. Populate exactly one `CatalogCoverage` entry for each ID. Use a manifest-style story reference such as:

```typescript
'tests/stories/chat-task/core.story.test.ts#SCN-task-create-update creates and updates a task through chat'
```

Do not mark an entry executable until its test has been written. Initial pending records must state whether the blocker is absent branch behavior, a catalog `gap`, a `contract-only` non-trigger, or an unavailable fake boundary.

- [ ] **Step 4: Make the contract pass and commit the inventory foundation**

Run:

```bash
bun test:stories:contracts -- tests/stories/harness/catalog-coverage.test.ts
git add tests/stories/catalog/coverage.ts tests/stories/harness/catalog-coverage.test.ts
git commit -m "test(stories): track scenario catalog coverage"
```

Expected: contract exits 0; every initial entry is pending with a concrete reason and no story reference is stale.

### Task 2: Extend only the reusable hermetic seams required by verified task stories

**Files:**

- Modify: `tests/stories/harness/memory-task-provider.ts`
- Modify: `tests/stories/harness/memory-task-provider.test.ts` (create if absent)
- Modify: `tests/stories/harness/scenario.ts`
- Modify: `tests/stories/harness/scenario.test.ts`

- [ ] **Step 1: Write provider contract tests before adding each optional family**

Add parameterized tests that start with comments/labels/relations/projects/statuses/attachments/work items/sprints/history/query capabilities absent, then configure one family and assert both the normalized return value and one sanitized event. For example:

```typescript
test('records label assignment and suppresses duplicate writes', async () => {
  const provider = new MemoryTaskProvider({ capabilities: ['tasks.labels'] })
  const task = await provider.createTask({ projectId: 'p1', title: 'Release' })
  const label = await provider.createLabel!({ name: 'release' })
  await provider.addTaskLabel!(task.id, label.id)
  await expect(provider.addTaskLabel!(task.id, label.id)).resolves.toEqual({ taskId: task.id, labelId: label.id })
  expect(provider.events()).toContainEqual(expect.objectContaining({ kind: 'task.label.add' }))
})
```

- [ ] **Step 2: Run the focused harness contracts and verify RED**

Run:

```bash
bun test tests/stories/harness/memory-task-provider.test.ts tests/stories/harness/scenario.test.ts
```

Expected: FAIL because the provider currently exposes only required task CRUD and no configured optional capability surface.

- [ ] **Step 3: Implement deterministic provider families and narrow scenario assertions**

Add a `capabilities?: readonly TaskCapability[]` option, deterministic maps/counters for each supported optional family, and methods only when that family is configured. Record IDs, operation names, and non-secret structural fields in `ScenarioEvents`; never record content, credential, or binary attachment bytes. Add `given.taskProvider(...)` only if a story needs a non-default capability set, and `then.noEvent(kind)`/`then.event(kind)` only if existing event assertions cannot state the required safety oracle.

Keep the provider a `TaskProvider`, not a second task-domain implementation: normalize and clone inputs/outputs, implement no remote protocol, and omit unsupported optional methods so production capability gating is exercised.

- [ ] **Step 4: Run contracts and commit the shared seam**

Run:

```bash
bun test:stories:contracts
bun typecheck
git add tests/stories/harness/memory-task-provider.ts tests/stories/harness/memory-task-provider.test.ts tests/stories/harness/scenario.ts tests/stories/harness/scenario.test.ts
git commit -m "test(stories): extend deterministic task provider fixtures"
```

Expected: both commands exit 0; existing stories retain their current output.

### Task 3: Implement task, context, and tool-policy catalog stories

**Files:**

- Create: `tests/stories/chat-task/core.story.test.ts`
- Create: `tests/stories/chat-task/collaboration.story.test.ts`
- Create: `tests/stories/chat-task/workflow.story.test.ts`
- Create: `tests/stories/context/policy.story.test.ts`
- Modify: `tests/stories/catalog/coverage.ts`

- [ ] **Step 1: Write failing core and policy stories**

Use literal names beginning with the catalog ID. Each tool call must use `callCapability()` and end with `answer()`. Add these minimum assertions:

```typescript
scenario('SCN-task-delete deletes only after the confidence gate permits it', async ({ given, when, then, world }) => {
  // seed member, DM, configured provider, and task
  // first scripted call returns the low-confidence/confirmation result; assert no task.delete event
  // second explicit decision deletes; assert reply and one task.delete event
})

scenario('SCN-task-deny removes a denied write capability before model generation', async ({ given, when, world }) => {
  // set update_task to deny through the production settings/tool preference path
  // send a chat request and assert every inspection excludes update_task and no task.update event exists
})
```

Cover every ID assigned to the first four rows of the destination matrix. Put a separate `scenario()` declaration around each catalog record, even when the happy and unhappy branches share fixture setup.

- [ ] **Step 2: Run the new files and verify RED**

Run:

```bash
bun test:stories -- tests/stories/chat-task/core.story.test.ts tests/stories/context/policy.story.test.ts
```

Expected: FAIL until optional provider families, policy fixtures, and literal stories are complete.

- [ ] **Step 3: Complete collaboration and workflow stories**

For every configured optional operation, prove the reply plus sanitized provider event. For every unsupported/confirmation/guest path, prove the tool is absent or returns its documented confirmation/failure result and no write event occurs. Use production `tool_prefs` routes or stores already exercised by settings tests; do not call an internal tool executor directly.

Move only verified IDs from pending to executable, using the exact manifest IDs. Keep `SCN-task-not-configured` and all policy IDs in the ledger even if they share a file with their happy-path counterpart.

- [ ] **Step 4: Run the task family and commit**

Run:

```bash
bun test:stories -- tests/stories/chat-task tests/stories/context
bun test:stories:contracts
git add tests/stories/chat-task tests/stories/context tests/stories/catalog/coverage.ts
git commit -m "test(stories): cover task and policy catalog scenarios"
```

Expected: both story and contract commands exit 0; ledger references resolve through the manifest extractor.

### Task 4: Implement provider-independent assistant, command, and interaction stories

**Files:**

- Create: `tests/stories/assistant/memos-recurring.story.test.ts`
- Create: `tests/stories/assistant/deferred-memory.story.test.ts`
- Create: `tests/stories/assistant/web-instructions-meta.story.test.ts`
- Create: `tests/stories/commands/core.story.test.ts`
- Create: `tests/stories/interactions/permission.story.test.ts`
- Modify: `tests/stories/catalog/coverage.ts`

- [ ] **Step 1: Write each scenario's happy and safety declaration**

Use deterministic scheduler state and `world.clock.advance()` for recurring/deferred records. Assert one delivery per due item and assert a second poll does not repeat it. For web/fetch-chat-link stories declare every allowed request on `world.http`; test quota/unauthorized/redirect failures by asserting the response/reply and the absence of a persisted fetch side effect. For command and callback records assert the platform/context permission branch as well as the reply.

```typescript
scenario(
  'SCN-interaction-permission-decision allows an ask-gated operation only after perm:a callback',
  async ({ given, when, then, world }) => {
    // create ask-gated update through production preference state
    // send the request, assert a permission prompt and no task.update event
    // dispatch the production callback data, assert completion and exactly one task.update event
  },
)
```

- [ ] **Step 2: Run RED then implement only missing scenario fixtures**

Run:

```bash
bun test:stories -- tests/stories/assistant tests/stories/commands tests/stories/interactions
```

Expected: initially FAIL for missing literal scenarios or a missing public scenario fixture. Add the smallest typed `given`/`when` capability required by the real runtime route; add its harness contract before relying on it.

- [ ] **Step 3: Classify unavailable paths honestly and commit**

Keep records that cannot be entered through `PapaiRuntime` pending, including the reason and required seam. Do not substitute a direct unit call for an unavailable end-to-end path.

Run:

```bash
bun test:stories:contracts
bun test:stories -- tests/stories/assistant tests/stories/commands tests/stories/interactions
git add tests/stories/assistant tests/stories/commands tests/stories/interactions tests/stories/harness tests/stories/catalog/coverage.ts
git commit -m "test(stories): cover assistant commands and interactions"
```

Expected: commands exit 0 and every moved ledger entry has an exact literal scenario reference.

### Task 5: Implement settings and HTTP route stories

**Files:**

- Create: `tests/stories/settings/auth-context.story.test.ts`
- Create: `tests/stories/settings/coding-admin.story.test.ts`
- Create: `tests/stories/http/notify-mcp.story.test.ts`
- Create: `tests/stories/http/operator-surfaces.story.test.ts`
- Modify: `tests/stories/catalog/coverage.ts`

- [ ] **Step 1: Write failing authenticated-route stories**

Reuse `given.settingsSession()` and `when.settingsRequest()` so cookie and CSRF behavior is production-real. For each settings namespace, pair an authorized mutation/readback with unauthenticated, non-admin, missing-CSRF, malformed-body, or cross-context denial. For `SCN-http-notify` and `SCN-http-mcp-plugin`, declare strict upstream expectations and assert an unauthorized request is rejected before an external call or state mutation.

```typescript
scenario(
  'SCN-settings-context-config rejects a CSRF-less cross-context task assignment',
  async ({ given, when, then }) => {
    // issue Alice's session; target Bob's context; omit CSRF through { csrf: false }
    // assert 403 and read back that Bob's task instance is unchanged
  },
)
```

- [ ] **Step 2: Run RED and add no route bypasses**

Run:

```bash
bun test:stories -- tests/stories/settings tests/stories/http
```

Expected: FAIL until the new literal scenarios and any narrowly typed response assertions exist. Do not invoke settings handler modules directly: use `PapaiRuntime.request` through the scenario API.

- [ ] **Step 3: Complete the route matrix and classify pending transcript/adapter paths**

Move bootstrap, identity, instances, context, coding, admin, notify, MCP, auth-claim, dashboard, billing/stats, and debug-panel records to executable only after a real route is observed. Keep transcript-viewer, Mattermost adapter-only, or unavailable route records pending if this runtime cannot expose their ingress without a new peer boundary.

- [ ] **Step 4: Verify and commit**

Run:

```bash
bun test:stories:contracts
bun test:stories -- tests/stories/settings tests/stories/http
git add tests/stories/settings tests/stories/http tests/stories/catalog/coverage.ts
git commit -m "test(stories): cover settings and HTTP catalog scenarios"
```

Expected: commands exit 0 with every route mutation followed by a real readback or no-mutation assertion.

### Task 6: Complete ACP story coverage against strict fake Magi

**Files:**

- Modify: `tests/stories/harness/fake-magi.ts`
- Modify: `tests/stories/harness/fake-magi.test.ts`
- Create: `tests/stories/integrations/coding-sessions/lifecycle.story.test.ts`
- Create: `tests/stories/integrations/coding-sessions/policy.story.test.ts`
- Modify: `tests/stories/catalog/coverage.ts`

- [ ] **Step 1: Write fake-Magi protocol tests before each endpoint extension**

For list, status, finish, cancel, continue, permission-answer, and MCP session endpoints, write one exact URL/method/auth/content-type assertion and one refusal test for an incorrect request. Preserve the existing sanitized event convention: record structural fields, secret names, and IDs only; never record a token, key, share token, prompt body, or MCP token.

- [ ] **Step 2: Run fake protocol tests and verify RED**

Run:

```bash
bun test tests/stories/harness/fake-magi.test.ts
```

Expected: FAIL for each endpoint not yet declared by `FakeMagi`.

- [ ] **Step 3: Add ACP lifecycle and policy stories**

Write a literal scenario per ACP record from the matrix. Happy paths assert fake-Magi consumption, persisted coding-session state, and reply. Unhappy paths assert no session record and no undesired request for missing configuration, self-hosted forge preflight, cautious permission denial, non-allowlisted actor, guest actor, and upstream error. The static `/acp` command proves no Magi request.

- [ ] **Step 4: Verify and commit**

Run:

```bash
bun test:stories:contracts
bun test:stories -- tests/stories/integrations/coding-sessions
git add tests/stories/harness/fake-magi.ts tests/stories/harness/fake-magi.test.ts tests/stories/integrations/coding-sessions tests/stories/catalog/coverage.ts
git commit -m "test(stories): cover ACP scenario catalog"
```

Expected: all strict expectations are consumed and no sanitized trace includes a configured secret.

### Task 7: Perform the nerv/supervision branch audit and finalize pending coverage

**Files:**

- Modify: `tests/stories/catalog/coverage.ts`
- Create only if reachable: `tests/stories/integrations/nerv/*.story.test.ts`
- Create only if protocol exists: `tests/stories/harness/fake-nerv.ts` and `tests/stories/harness/fake-nerv.test.ts`

- [ ] **Step 1: Audit every remaining pending record against the current branch**

For each remaining ID, record the checked ingress and result in its ledger reason. Use the current source path, not catalog status, to decide among: absent feature, `gap`, `contract-only`, platform-only ingress, or reachable production protocol needing a fake. The expected initial pending group is every `SCN-coding-nerv-*` and `SCN-supervise-*` record plus catalog gaps such as transcript viewer and retired `/announce`.

- [ ] **Step 2: If and only if a real nerv ingress and contract exist, add a RED fake and story**

Write `FakeNerv` contract tests that reject an incorrect method, URL, authorization header, or body before any story uses it. Then add the literal chat/HTTP story through `PapaiRuntime`; assert task state and reply for success, and no mutation/request for denied, conflict, or malformed input.

- [ ] **Step 3: Re-run ledger and all story verification**

Run:

```bash
bun test:stories:contracts
bun test:stories
bun test:stories:stress
```

Expected: all commands exit 0. If a nerv boundary is still absent, no `fake-nerv` files are created and every related record remains pending with an explicit reason.

- [ ] **Step 4: Finalize documentation and commit**

Update each pending reason with its final branch-audit evidence, ensure every executable entry names a literal manifest scenario, and commit:

```bash
git add tests/stories/catalog/coverage.ts tests/stories/integrations/nerv tests/stories/harness/fake-nerv.ts tests/stories/harness/fake-nerv.test.ts
git commit -m "test(stories): finalize scenario catalog coverage"
```

If the optional paths do not exist, omit them from `git add`; the ledger-only update is the intended result.

## Final verification checklist

- [ ] `git diff --check` exits 0.
- [ ] `bun test:stories:contracts` exits 0.
- [ ] `bun test:stories` exits 0.
- [ ] `bun test:stories:stress` exits 0.
- [ ] `bun test:stories:manifest` reports every literal `SCN-*` story and the ledger contract resolves all executable references.
- [ ] No story uses `test.skip`, a live network request, a direct production tool execution, `setTimeout` waiting, or a credential-bearing event assertion.
- [ ] `git status --short` contains only the intentional coverage implementation changes.
