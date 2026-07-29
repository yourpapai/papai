<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tier-0 Runtime Flows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote the five approved Phase 3 Tier-0 runtime-flow records with deterministic literal stories and exact catalog mappings.

**Architecture:** Add three narrowly scoped Tier-0 story files/sections that exercise the existing queue, cache/usage, and plugin runtimes without changing production behavior. Each catalog ID receives one literal scenario, then exactly those five records move from pending audit records to executable mappings.

**Tech Stack:** Bun test runner, Tier-0 hermetic story runner, SQLite/Drizzle test database, existing scenario harness, Bun mocks and deferred promises.

## Global Constraints

- Do not change `src/**`, runtime behavior, or add a new fixture seam.
- Preserve the five behavior-level catalog boundaries; one scenario may claim only its assigned ID.
- Tier-0 stories must be deterministic: use deferred promises, `forceFlush`, microtask/state polling, and fixed timestamps; never fixed debounce-duration sleeps.
- Reuse the real scenario SQLite database and plugin lifecycle; do not use live network, filesystem mutation, or an LLM decision where direct runtime entry points suffice.
- Add literal story IDs under `tests/stories/**` and map each at Tier 0 with an implementation verification date.
- Keep all other Phase 3 records in `AUDIT_RECORDS` pending.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `tests/stories/runtime/queue.story.test.ts` | Literal queue coalescing and group/thread serialization scenarios using `MessageQueue`. |
| `tests/stories/runtime/persistence-and-usage.story.test.ts` | Separate real-DB cache-persistence and usage-accounting scenarios. |
| `tests/stories/integrations/plugins/eligibility.story.test.ts` | Existing synthetic-plugin lifecycle extended with denial-before-execution coverage. |
| `tests/stories/catalog/coverage.ts` | Exact mappings for these five IDs; removal of only those audit records. |

### Task 1: Add deterministic queue runtime stories

**Files:**
- Create: `tests/stories/runtime/queue.story.test.ts`
- Modify: `tests/stories/catalog/coverage.ts`
- Test: `tests/stories/runtime/queue.story.test.ts`

**Interfaces:**
- Consumes: `MessageQueue.enqueue(item, reply)`, `MessageQueue.setHandler(handler)`, and `MessageQueue.forceFlush()` from `src/message-queue/queue.ts`; `QueueItem` and `CoalescedItem` from `src/message-queue/types.ts`; `scenario()` from `tests/stories/harness/scenario.ts`.
- Produces: literal Tier-0 scenario IDs `SCN-queue-coalescing: same-actor messages form one ordered turn` and `SCN-queue-group-serialization: actor changes flush and serialize group-thread turns`.

- [ ] **Step 1: Write the failing queue stories**

  Create the story file with a local `groupItem(userId, text, attachmentIds = [])` helper and a `createMockReply()` helper. Use a `scenario()` callback for each literal ID. The coalescing scenario must use only Alice:

  ```ts
  scenario('SCN-queue-coalescing: same-actor messages form one ordered turn', () => {
    const queue = new MessageQueue('group-1:thread-1')
    const firstReply = createReply()
    const lastReply = createReply()
    queue.enqueue(groupItem('alice', 'first', ['att-1']), firstReply)
    queue.enqueue(groupItem('alice', 'second', ['att-2']), lastReply)

    const turn = queue.forceFlush()
    expect(turn).not.toBeNull()
    expect(turn?.text).toBe('[@alice]: first\n[@alice]: second')
    expect(turn?.newAttachmentIds).toEqual(['att-1', 'att-2'])
    expect(turn?.reply).toBe(lastReply)
  })
  ```

  In the serialization scenario, install a handler that pushes `start:` plus the coalesced text and `end:` plus the coalesced text, increments/decrements `active`, records `maxActive`, and waits only when handling Alice's item. Enqueue Alice then Bob, resolve Alice's deferred promise, and use `waitFor` to wait for two completed handler invocations. Assert `['start:[@alice]: one', 'end:[@alice]: one', 'start:[@bob]: two', 'end:[@bob]: two']` and `maxActive === 1`. Add a second controlled run where Alice rejects; assert Bob completes after it and the handler chain is not deadlocked.

- [ ] **Step 2: Run the new story file to verify the catalog census fails before mapping**

  Run:

  ```sh
  bun test:stories
  ```

  Expected: FAIL because the two new literal scenario IDs are not yet claimed by the bidirectional catalog census. Do not alter the queue runtime to address this failure.

- [ ] **Step 3: Add the two exact catalog mappings**

  In `tests/stories/catalog/coverage.ts`, add executable Tier-0 entries for the two queue IDs, each pointing only to its exact `tests/stories/runtime/queue.story.test.ts#scenario name` string and using the implementation date. Remove only `SCN-queue-coalescing` and `SCN-queue-group-serialization` from `AUDIT_RECORDS`.

  ```ts
  'SCN-queue-coalescing': {
    verifiedAt: '2026-07-29',
    provingTier: '0',
    storyIds: ['tests/stories/runtime/queue.story.test.ts#SCN-queue-coalescing: same-actor messages form one ordered turn'],
  },
  ```

  Give `SCN-queue-group-serialization` the same shape with only its serialization scenario ID. Do not add either story ID to `tests/stories/catalog/supporting.ts`.

- [ ] **Step 4: Run queue and catalog verification**

  Run:

  ```sh
  bun test:stories:contracts
  bun test:stories
  bun run test -- tests/message-queue
  ```

  Expected: PASS. The story report contains both queue scenarios, the census has no unclaimed scenario, and existing queue unit tests continue to pass.

- [ ] **Step 5: Commit the queue slice**

  ```sh
  git add tests/stories/runtime/queue.story.test.ts tests/stories/catalog/coverage.ts
  git commit -m "test(stories): cover queue runtime flows"
  ```

### Task 2: Add separate cache persistence and usage accounting stories

**Files:**
- Create: `tests/stories/runtime/persistence-and-usage.story.test.ts`
- Modify: `tests/stories/catalog/coverage.ts`
- Test: `tests/stories/runtime/persistence-and-usage.story.test.ts`

**Interfaces:**
- Consumes: `cacheMessage`, `getMessageContext`, `buildReplyChain` from `src/message-cache`; `initUsageRecorder`, `resetUsageRecorderForTesting`, `emitUser`, `recordUsage`, and `listSubjects` from `src/usage`/event bus; real scenario database from `executeScenario()`.
- Produces: literal Tier-0 IDs `SCN-message-cache-persistence: persisted messages retain context and reply-chain boundaries` and `SCN-usage-accounting: idempotent request and tool events remain window-queryable`.

- [ ] **Step 1: Write the failing cache scenario**

  In the new file, use `executeScenario()` so the scenario-owned real SQLite database is initialized and cleaned up. Write eligible cache messages through `cacheMessage`: root `m-1` and reply `m-2` in `thread-A`/`group-A`, then same ID `m-1` in `thread-B`/`group-B`. Wait for an observable DB-backed read with `waitFor(() => getMessageContext(groupScope, 'm-2', 0, 0, 'reply_chain').target !== undefined)`; do not sleep.

  ```ts
  const chain = buildReplyChain('thread-A', 'm-2')
  expect(chain).toMatchObject({ chain: ['m-1', 'm-2'], isComplete: true })
  expect(getMessage({ kind: 'group', groupContextId: 'group-B' }, 'm-2')).toBeUndefined()
  expect(getMessageContext({ kind: 'group', groupContextId: 'group-B' }, 'm-2', 1, 1, 'reply_chain'))
    .toEqual({ target: undefined, before: [], after: [] })
  ```

  Add a broken-chain input (`m-4` replying to absent `m-3`) and assert the existing `isComplete: false`/`brokenAt: 'm-3'` result. Do not emit a usage event in this scenario.

- [ ] **Step 2: Write the failing usage scenario**

  In a separate literal scenario in the same file, reset and initialize the real usage subscriber. Capture `const now = Date.now()` once. Emit an identical `llm:end` event twice with the same turn ID, response ID, and event timestamp; emit an identical `tool:execute_end` event twice with the same turn/tool-call IDs; then emit one old LLM event at `now - 10 * dayMs`.

  ```ts
  expect(getDrizzleDb().select().from(llmUsageEvents).all()).toHaveLength(2)
  expect(getDrizzleDb().select().from(toolCallEvents).all()).toHaveLength(1)
  expect(listSubjects({ windowMs: dayMs }).map(({ storageContextId }) => storageContextId)).toEqual(['recent-context'])
  expect(listSubjects({ windowMs: null }).map(({ storageContextId }) => storageContextId)).toEqual(
    expect.arrayContaining(['recent-context', 'old-context']),
  )
  ```

  Assert the recent aggregate's input/output tokens and tool count exactly. Emit a malformed `llm:end` and a non-user event, then assert no extra usage row was written and a separately subscribed listener still received the malformed event. Always call `resetUsageRecorderForTesting()` in `finally` so no subscriber crosses scenario teardown.

- [ ] **Step 3: Run the new story file to verify the catalog census fails before mapping**

  Run:

  ```sh
  bun test:stories
  ```

  Expected: FAIL only because these two literal scenarios are unclaimed. The runtime assertions should otherwise be valid; do not solve a catalog failure with a supporting-story exemption.

- [ ] **Step 4: Add the two exact catalog mappings**

  Add Tier-0 executable mappings in `tests/stories/catalog/coverage.ts` for `SCN-message-cache-persistence` and `SCN-usage-accounting`, each pointing only at its exact scenario string in `tests/stories/runtime/persistence-and-usage.story.test.ts`. Remove only those two audit records. The cache mapping must not list the usage scenario and the usage mapping must not list the cache scenario.

- [ ] **Step 5: Run persistence/accounting verification**

  Run:

  ```sh
  bun test:stories:contracts
  bun test:stories
  bun run test -- tests/message-cache tests/usage
  ```

  Expected: PASS. Cache scope/chain tests and usage event/query tests remain independently green, and the catalog claims each literal story once.

- [ ] **Step 6: Commit the persistence/accounting slice**

  ```sh
  git add tests/stories/runtime/persistence-and-usage.story.test.ts tests/stories/catalog/coverage.ts
  git commit -m "test(stories): cover cache and usage runtime flows"
  ```

### Task 3: Add pre-execution plugin-denial coverage

**Files:**
- Modify: `tests/stories/integrations/plugins/eligibility.story.test.ts`
- Modify: `tests/stories/catalog/coverage.ts`
- Test: `tests/stories/integrations/plugins/eligibility.story.test.ts`

**Interfaces:**
- Consumes: existing `discovered()`, `capabilityConstrainedClone()`, `given.plugin()`, `world.start()`, and `buildProviderlessToolDescriptors()` setup; `buildPluginToolRuntimeContext()` and `createMockProvider()` for the denied-facade check.
- Produces: literal Tier-0 ID `SCN-plugin-deny-gating: unavailable plugin capabilities are removed before execution`.

- [ ] **Step 1: Write the failing plugin-denial scenario**

  Add a separate `executeScenario()` case. Discover the synthetic plugin, clone it with `requiredChatCapabilities: ['users.resolve']`, approve and enable it for Alice's context, then start the world. Build descriptors and prove the tool is absent before any LLM decision or `execute` invocation:

  ```ts
  expect(pluginRegistry.getEntry(CONSTRAINED_PLUGIN_ID)?.state).toBe('incompatible')
  expect(getActivatedPluginIds()).not.toContain(CONSTRAINED_PLUGIN_ID)
  expect(await toolNames(contextId, alice.id)).not.toContain(TOOL_NAME)
  ```

  Add a focused denied-facade assertion in that scenario. Build a manifest with no `tasks.read` permission, use a provider spy/mocked provider whose `getTask` records calls, then call `runtime.taskProvider?.getTask('task-1')`. Assert the permission error and zero provider calls. Keep the assertion at the facade boundary; do not expose or call a raw provider from plugin code.

- [ ] **Step 2: Run the plugin story to verify the catalog census fails before mapping**

  Run:

  ```sh
  bun test:stories
  ```

  Expected: FAIL because the new literal plugin-denial scenario is unclaimed. Existing `SCN-plugin-context-eligibility` and `SCN-plugin-contribution-isolation` mappings must remain unchanged.

- [ ] **Step 3: Add the exact plugin-denial mapping**

  In `tests/stories/catalog/coverage.ts`, add the Tier-0 mapping for `SCN-plugin-deny-gating` with only the new literal scenario ID and `verifiedAt: '2026-07-29'`. Remove only its `AUDIT_RECORDS` entry. Do not repoint either existing plugin eligibility mapping to this new scenario.

- [ ] **Step 4: Run plugin and complete Tier-0 verification**

  Run:

  ```sh
  bun test:stories:contracts
  bun test:stories
  bun test:stories:stress
  bun run test -- tests/plugins
  ```

  Expected: PASS. The missing capability removes the tool before execution, the denied facade fails before provider delegation, all five new records are executable, and all remaining Phase 3 records remain pending.

- [ ] **Step 5: Commit the plugin-denial slice**

  ```sh
  git add tests/stories/integrations/plugins/eligibility.story.test.ts tests/stories/catalog/coverage.ts
  git commit -m "test(stories): cover plugin denial gating"
  ```

### Task 4: Run frozen-input qualification and final catalog review

**Files:**
- Modify: none expected
- Test: all files changed by Tasks 1–3

**Interfaces:**
- Consumes: the committed frozen story/harness baseline SHA approved for the branch.
- Produces: proof that the frozen story inputs and live runtime execute compatibly, plus a clean worktree.

- [ ] **Step 1: Inspect the final catalog diff**

  Run:

  ```sh
  git diff HEAD~3..HEAD -- tests/stories/catalog/coverage.ts
  ```

  Expected: exactly five Phase 3 IDs moved from `AUDIT_RECORDS` to `EXECUTABLE_STORY_MAPPINGS`; no unrelated catalog record, supporting exemption, proving tier, or story family changed.

- [ ] **Step 2: Run baseline preflight**

  Run:

  ```sh
  BASE_REF="$(git merge-base HEAD origin/master)" bun test:stories:compat --manifest-only
  ```

  Expected: PASS after intentionally accepting the frozen story/catalog changes against the selected baseline. If this reports an unexpected frozen file, inspect the diff and remove the unintended change rather than weakening compatibility.

- [ ] **Step 3: Run full compatibility proof**

  Run:

  ```sh
  BASE_REF="$(git merge-base HEAD origin/master)" bun test:stories:compat
  ```

  Expected: PASS with the immutable captured story inputs and the live candidate runtime.

- [ ] **Step 4: Commit any intentional final metadata correction**

  Only if a catalog date or literal story ID correction is required:

  ```sh
  git add tests/stories/catalog/coverage.ts
  git commit -m "test(stories): finalize runtime flow catalog mappings"
  ```

  Otherwise make no empty commit.

## Spec Coverage Review

- Three-file split: Tasks 1–3.
- Queue coalescing distinct from serialization: Task 1's separate scenarios and assertions.
- Cache persistence distinct from usage accounting: Task 2's separate scenarios and tables.
- Pre-execution capability gating and no provider escape: Task 3.
- Deterministic debounce/order/persistence: Tasks 1–2 global constraints and explicit steps.
- Failure behavior: rejected queue handler, incomplete cache chain, malformed usage events, and denied facade are explicit in Tasks 1–3.
- Verification commands and compatibility proof: Tasks 1–4.
