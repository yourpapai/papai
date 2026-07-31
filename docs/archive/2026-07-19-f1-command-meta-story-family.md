<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# F1 Command-Surface and Meta-Tools Story Family Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all 17 executable-candidate F1 scenarios (`cmd-*` + `meta-*`) real, moving the catalog ledger from 32 to 49 executable stories.

**Architecture:** One production seam (capability registration for `expand_result` and `search_tools`), four harness additions (`contains` matcher, `given.groupAdmin` + scenario-chat `isGroupAdmin`, gated scripted-LLM decision with `when.dispatchMessage`, `$compaction:latest` sentinel), then two story files (14 command scenarios + 3 meta scenarios), then the ledger update.

**Tech Stack:** Bun, TypeScript (strict), bun:test, Vercel AI SDK (`MockLanguageModelV3`).

**Spec:** `docs/superpowers/specs/2026-07-19-f1-command-meta-story-family-design.md`

**Ledger after this plan:** 128 ids, 49 executable, 79 pending (5 `executable-as-is`, 52 `needs-seam`, 22 `blocked`). Story suite: 40 → 57 scenarios.

**Frozen-tree note:** this plan changes frozen inputs (harness, catalog). Re-record the compat baseline after landing. Stories run sandboxed: `bun test:stories`; harness contract suites: `bun test:stories:contracts`; direct catalog test runs need `bun test --path-ignore-patterns '' <file>` (bunfig excludes `tests/stories/**` from default discovery).

**Approved deviation from spec:** the oversized-payload trigger for `meta-expand-result` is seeded through the real `create_task` tool path (a >8 000-byte description in the scripted input) instead of a dedicated `MemoryTaskProvider` knob — more behavioral, one less harness surface. The spec's knob option is dropped.

**Lint reminders:** `vitest/no-conditional-tests`/`no-conditional-expect` — no `if`/ternary/`&&` around tests or expects in test bodies; use single-predicate filters and top-level helpers. No lint-disable or type-ignore comments. Import paths use `.js` extensions.

---

### Task 1: `meta.expand-result` capability registration (production)

**Files:**

- Modify: `src/tools/core-capabilities.ts:10-15`
- Test: `tests/tools/core-capabilities.test.ts`

- [ ] **Step 1: Update the failing test first**

In `tests/tools/core-capabilities.test.ts`, replace the test `registers the four stable task capabilities when their real wire tools are offered` with:

```typescript
test('registers the stable core capabilities when their real wire tools are offered', () => {
  const catalog = createToolCapabilityCatalog()

  registerOfferedCoreToolCapabilities(offered(...Object.values(CORE_TOOL_CAPABILITIES)), catalog)

  expect(catalog.entries()).toEqual([
    ['tasks.create', 'create_task'],
    ['tasks.get', 'get_task'],
    ['tasks.list', 'list_tasks'],
    ['tasks.search', 'search_tasks'],
    ['meta.expand-result', 'expand_result'],
  ])
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/tools/core-capabilities.test.ts`
Expected: FAIL — actual entries lack `['meta.expand-result', 'expand_result']`.

- [ ] **Step 3: Add the entry**

In `src/tools/core-capabilities.ts`, append to `CORE_TOOL_CAPABILITIES` (after the four task entries — insertion order matters for the test above):

```typescript
export const CORE_TOOL_CAPABILITIES = Object.freeze({
  'tasks.create': 'create_task',
  'tasks.get': 'get_task',
  'tasks.list': 'list_tasks',
  'tasks.search': 'search_tasks',
  'meta.expand-result': 'expand_result',
} as const)
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test tests/tools/core-capabilities.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/core-capabilities.ts tests/tools/core-capabilities.test.ts
git commit -m "feat(tools): register expand_result as a stable tool capability"
```

---

### Task 2: `contains` reply matcher and `given.groupAdmin` fixture

**Files:**

- Modify: `tests/stories/harness/scenario.ts:154` (`ReplyAssertion` type), `:265-272` (`replyAssertion` impl), plus `ScenarioGiven` type and `createGiven`
- Modify: `tests/stories/harness/chat.ts` (add `isGroupAdmin` to the scenario chat provider)
- Modify: `tests/stories/harness/fixtures.ts` (group-admin seeding)
- Test: `tests/stories/harness/scenario.test.ts`, `tests/stories/harness/fixtures.test.ts`

The `contains` matcher is needed because `/config` replies embed a random single-use code. The `groupAdmin` fixture is needed because `auth.isGroupAdmin` resolves through the chat provider's `isGroupAdmin` method (`src/chat/router-helpers.ts:97-104`), which the scenario chat does not implement today.

- [ ] **Step 1: Write the failing `contains` contract test**

In `tests/stories/harness/scenario.test.ts`, add a mini-scenario following the file's existing pattern (line ~88 shows the shape):

```typescript
test('replyTo.contains asserts a substring of the latest reply', async () => {
  await executeScenario('contains matcher', async ({ given, when, then }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    given.llm([answer('the code is xyzzy — do not share it')])

    await when.message(alice, dm, 'give me a secret')

    then.replyTo(alice).contains('the code is')
    then.replyTo(alice).contains('do not share it')
    expect(() => then.replyTo(alice).contains('not present')).toThrow()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test --path-ignore-patterns '' tests/stories/harness/scenario.test.ts`
Expected: FAIL — `then.replyTo(...).contains is not a function`.

- [ ] **Step 3: Implement the matcher**

In `tests/stories/harness/scenario.ts`, change the `ReplyAssertion` type (line 154) to:

```typescript
type ReplyAssertion = Readonly<{ equals(expected: string): void; contains(expected: string): void }>
```

And extend `replyAssertion` (line 265-272):

```typescript
function replyAssertion(world: ScenarioWorld, replies: () => readonly { content?: string }[]): ReplyAssertion {
  return {
    equals(expected): void {
      const captured = replies().filter(({ content }) => content !== undefined)
      tracedAssertion(world, () => expect(captured.at(-1)?.content).toBe(expected))
    },
    contains(expected): void {
      const captured = replies().filter(({ content }) => content !== undefined)
      tracedAssertion(world, () => expect(captured.at(-1)?.content).toContain(expected))
    },
  }
}
```

- [ ] **Step 4: Write the failing group-admin contract test**

In `tests/stories/harness/fixtures.test.ts`, add:

```typescript
test('given.groupAdmin marks the member as a group admin for command auth', async () => {
  await executeScenario('group admin fixture', async ({ given, when, then }) => {
    const carol = given.user('carol')
    const team = given.group('team')
    given.member(team, carol)
    given.groupAdmin(team, carol)
    given.llm([answer('ok')])

    await when.message(carol, team, '/config')

    then.replyTo(carol).contains('Open a DM with me and run /config')
  })
})
```

(GROUP_CONFIG_REDIRECT is `'Group settings are configured in direct messages with the bot. Open a DM with me and run /config.'` — asserted via `contains` as a second use of the new matcher. A plain member instead gets the admin-only message — proven by the story in Task 5.)

- [ ] **Step 5: Run to verify it fails**

Run: `bun test --path-ignore-patterns '' tests/stories/harness/fixtures.test.ts`
Expected: FAIL — `given.groupAdmin is not a function`.

- [ ] **Step 6: Implement group-admin seeding**

In `tests/stories/harness/chat.ts`:

1. Add near the `commands` map declaration:

```typescript
const groupAdmins = new Set<string>()
```

2. Add to the returned provider object (next to `renderContext`):

```typescript
    isGroupAdmin(_platformInstanceId: string, groupId: string, userId: string): Promise<boolean> {
      return Promise.resolve(groupAdmins.has(`${groupId}:${userId}`))
    },
```

3. Expose a seed method on the chat object the world can call. Find how the world accesses the scenario chat (the `createScenarioChat` return — add a method to its returned API object, not the provider): e.g. `addGroupAdmin(groupId: string, userId: string): void { groupAdmins.add(`${groupId}:${userId}`) }`. Follow the file's existing internal-structure pattern.

In `tests/stories/harness/fixtures.ts`, add to the fixtures surface:

```typescript
  seedGroupAdmin(input: Readonly<{ groupId: string; userId: string }>): void
```

implemented by delegating to the chat's `addGroupAdmin`. The world wires the chat instance into fixtures (look at how `world.tasks` is exposed for a pattern).

In `tests/stories/harness/scenario.ts`, add to `ScenarioGiven` (type + `createGiven` impl):

```typescript
    groupAdmin(group: GroupHandle, user: UserHandle): void {
      prerequisite('given.groupAdmin')
      world.fixtures.seedGroupAdmin({ groupId: scopedGroupId(group), userId: user.id })
    },
```

- [ ] **Step 7: Run both contract suites to verify they pass**

Run: `bun test --path-ignore-patterns '' tests/stories/harness/scenario.test.ts tests/stories/harness/fixtures.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add tests/stories/harness/scenario.ts tests/stories/harness/chat.ts tests/stories/harness/fixtures.ts tests/stories/harness/scenario.test.ts tests/stories/harness/fixtures.test.ts
git commit -m "test(stories): add contains reply matcher and groupAdmin fixture"
```

---

### Task 3: Gated scripted-LLM decision and `when.dispatchMessage`

**Files:**

- Modify: `tests/stories/harness/scripted-llm.ts` (new decision kind, `nextGate`, abort handling, `verifyConsumed` gate safety)
- Modify: `tests/stories/harness/scenario.ts` (`ScenarioWhen` + `createWhen`: `dispatchMessage`)
- Test: `tests/stories/harness/scripted-llm.test.ts`

This is the mid-turn seam for the stop stories. `when.message` settles synchronously, so a parked turn would deadlock it — both the work message and the `/stop` must dispatch without settling, and the story calls `world.settle()` explicitly after `gate.release()`.

- [ ] **Step 1: Write the failing contract tests**

In `tests/stories/harness/scripted-llm.test.ts`, add (following the file's existing harness setup — it builds a scripted model with stub `resolveCapability` and calls `model.doGenerate` directly; mirror the autoLoadTools tests at ~line 171):

```typescript
test('gate decision parks doGenerate until released', async () => {
  const model = createScriptedModel({ resolveCapability: () => 'create_task' })
  model.enqueue([gateCall('tasks.create', { title: 'x' })])
  const gatePromise = model.nextGate()

  let settled = false
  const generation = model.model.doGenerate(baseCallOptions).then((result) => {
    settled = true
    return result
  })
  const gate = await gatePromise

  expect(settled).toBe(false)
  gate.release()
  const result = await generation
  expect(settled).toBe(true)
  expect(result.content[0]).toMatchObject({ type: 'tool-call', toolName: 'create_task' })
})

test('gate rejects on abort and clears the pending tool call', async () => {
  const model = createScriptedModel({ resolveCapability: () => 'create_task' })
  model.enqueue([gateCall('tasks.create', { title: 'x' })])
  const controller = new AbortController()
  const gatePromise = model.nextGate()

  const generation = model.model.doGenerate({ ...baseCallOptions, abortSignal: controller.signal })
  await gatePromise
  controller.abort(new Error('stop'))

  await expect(generation).rejects.toThrow('stop')
  expect(() => model.verifyConsumed()).not.toThrow()
})

test('verifyConsumed fails an unreleased gate and releases it for teardown', async () => {
  const model = createScriptedModel({ resolveCapability: () => 'create_task' })
  model.enqueue([gateCall('tasks.create', { title: 'x' })])
  const gatePromise = model.nextGate()
  void model.model.doGenerate(baseCallOptions).catch(() => undefined)
  await gatePromise

  expect(() => model.verifyConsumed()).toThrow('gate was never released')
  expect(() => model.verifyConsumed()).not.toThrow()
})
```

(`baseCallOptions` — use the file's existing call-options fixture; if it is named differently, use the existing one.)

- [ ] **Step 2: Run to verify they fail**

Run: `bun test --path-ignore-patterns '' tests/stories/harness/scripted-llm.test.ts`
Expected: FAIL — `gateCall`/`nextGate` do not exist.

- [ ] **Step 3: Implement the gated decision**

In `tests/stories/harness/scripted-llm.ts`:

1. Extend the decision union and add the helpers:

```typescript
export type ModelDecision =
  | { kind: 'tool'; capabilityId: string; input: unknown }
  | { kind: 'tool-gate'; capabilityId: string; input: unknown }
  | { kind: 'answer'; text: string }

export type GatedToolCall = Readonly<{ release(): void }>

export const gateCall = (capabilityId: string, input: unknown): ModelDecision => ({
  kind: 'tool-gate',
  capabilityId,
  input,
})
```

2. Extend `ScriptedModel` with `nextGate(): Promise<GatedToolCall>`.

3. In `createScriptedModel`, add state:

```typescript
let parkedGate: GatedToolCall | undefined
const gateWaiters: Array<(gate: GatedToolCall) => void> = []
```

4. In `runDecision`, treat `'tool-gate'` exactly like `'tool'`: the existing `if (decision.kind === 'answer')` branch is unchanged; the tool path below it already handles the decision via `decision.capabilityId`/`decision.input` — ensure the union narrowing works (both kinds carry those fields).

5. Replace `doGenerate` with gate-aware parking:

```typescript
const doGenerate = (callOptions: LanguageModelV3CallOptions): Promise<LanguageModelV3GenerateResult> => {
  const gated = decisions[0]?.kind === 'tool-gate'
  const result = runDecision(callOptions)
  if (!gated) return Promise.resolve(result)
  return new Promise<LanguageModelV3GenerateResult>((resolve, reject) => {
    const signal = callOptions.abortSignal
    const onAbort = (): void => {
      pendingToolCall = undefined
      parkedGate = undefined
      const reason: unknown = signal?.reason
      reject(reason instanceof Error ? reason : new Error('Generation aborted'))
    }
    const gate: GatedToolCall = {
      release: () => {
        signal?.removeEventListener('abort', onAbort)
        if (parkedGate === gate) parkedGate = undefined
        resolve(result)
      },
    }
    parkedGate = gate
    for (const waiter of gateWaiters.splice(0)) waiter(gate)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
```

6. Add to the returned object:

```typescript
    nextGate(): Promise<GatedToolCall> {
      if (parkedGate !== undefined) return Promise.resolve(parkedGate)
      return new Promise((resolve) => gateWaiters.push(resolve))
    },
```

7. At the top of `verifyConsumed`, add gate safety (releases so teardown never leaves a parked promise, then fails the story):

```typescript
    verifyConsumed(): void {
      if (parkedGate !== undefined) {
        const gate = parkedGate
        parkedGate = undefined
        gate.release()
        throw new Error('Scripted model gate was never released')
      }
      // ...existing pendingToolCall and unused-decisions checks unchanged...
    },
```

- [ ] **Step 4: Add `when.dispatchMessage`**

In `tests/stories/harness/scenario.ts`, extend `ScenarioWhen` (type at ~line 141) and `createWhen` with:

```typescript
    async dispatchMessage(user, context, text): Promise<void> {
      world.events.setPhase('when.dispatchMessage')
      await world.ensureStarted()
      await world.runtime.dispatch(messageForContext(world, user, context, text))
    },
```

(Dispatches without settling — used only by the stop stories; `when.message` keeps its dispatch+settle behavior.)

- [ ] **Step 5: Run the contract tests to verify they pass**

Run: `bun test --path-ignore-patterns '' tests/stories/harness/scripted-llm.test.ts`
Expected: PASS (new and existing tests).

- [ ] **Step 6: Commit**

```bash
git add tests/stories/harness/scripted-llm.ts tests/stories/harness/scripted-llm.test.ts tests/stories/harness/scenario.ts
git commit -m "test(stories): add gated scripted-LLM decision and dispatchMessage"
```

---

### Task 4: `$compaction:latest` sentinel in scripted tool input

**Files:**

- Modify: `tests/stories/harness/scripted-llm.ts` (sentinel resolution)
- Test: `tests/stories/harness/scripted-llm.test.ts`

The expand-result story must reference the compaction handle produced by the runtime without coupling to the internal `res_<hex>` counter. The scripted model scans tool-result prompt parts for a `CompactedEnvelope` (`_compacted: true`) and substitutes the sentinel with its handle.

- [ ] **Step 1: Write the failing contract tests**

In `tests/stories/harness/scripted-llm.test.ts`, add:

```typescript
test('resolves $compaction:latest from the latest compacted tool result', async () => {
  const model = createScriptedModel({ resolveCapability: () => 'expand_result' })
  model.enqueue([callCapability('meta.expand-result', { handle: '$compaction:latest', limit: 100 })])
  const compactedPrompt = promptWithToolResultPayload('call-1', 'list_tasks', {
    _compacted: true,
    handle: 'res_3',
    summary: 'compacted',
    totalBytes: 9000,
  })

  const result = await model.model.doGenerate(compactedPrompt)

  expect(result.content[0]).toMatchObject({
    type: 'tool-call',
    toolName: 'expand_result',
    input: JSON.stringify({ handle: 'res_3', limit: 100 }),
  })
})

test('fails when $compaction:latest has no compacted tool result to resolve', async () => {
  const model = createScriptedModel({ resolveCapability: () => 'expand_result' })
  model.enqueue([callCapability('meta.expand-result', { handle: '$compaction:latest' })])

  await expect(model.model.doGenerate(baseCallOptions)).rejects.toThrow(
    `'$compaction:latest' was used before any compacted tool result was observed`,
  )
})
```

(`promptWithToolResultPayload` — the file already has a `promptWithToolResult` helper; add a payload-carrying variant next to it if none exists, following its exact shape.)

- [ ] **Step 2: Run to verify they fail**

Run: `bun test --path-ignore-patterns '' tests/stories/harness/scripted-llm.test.ts`
Expected: FAIL — sentinel is passed through literally (first test) or no error (second).

- [ ] **Step 3: Implement the sentinel**

In `tests/stories/harness/scripted-llm.ts`:

1. Add near the helpers:

```typescript
export const COMPACTION_LATEST = '$compaction:latest'

const findCompactionHandle = (value: unknown): string | undefined => {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  if (record['_compacted'] === true && typeof record['handle'] === 'string') return record['handle']
  for (const nested of Object.values(record)) {
    const handle = findCompactionHandle(nested)
    if (handle !== undefined) return handle
  }
  return undefined
}

const latestCompactionHandle = (options: LanguageModelV3CallOptions): string | undefined => {
  let handle: string | undefined
  for (const message of options.prompt) {
    if (typeof message.content === 'string') continue
    for (const part of message.content) {
      if (part.type !== 'tool-result') continue
      handle = findCompactionHandle(part) ?? handle
    }
  }
  return handle
}
```

2. In `runDecision`, before `serializeToolInput`, substitute the sentinel in the decision input:

```typescript
let decisionInput = decision.input
if (JSON.stringify(decisionInput).includes(COMPACTION_LATEST)) {
  const handle = latestCompactionHandle(callOptions)
  if (handle === undefined) {
    throw new Error(`'${COMPACTION_LATEST}' was used before any compacted tool result was observed`)
  }
  decisionInput = JSON.parse(
    JSON.stringify(decisionInput).split(JSON.stringify(COMPACTION_LATEST)).join(JSON.stringify(handle)),
  )
}
```

and use `decisionInput` in the existing `serializeToolInput({ ...decision, input: decisionInput }, generation)` call (adjust the call site to pass the substituted input; `serializeToolInput` takes the decision — either extend it to take input directly or construct the shallow copy).

(The JSON round-trip replacement keeps the sentinel usable at any depth of the input object. The `JSON.stringify(decisionInput).includes(...)` pre-check avoids the parse cost on the common path.)

- [ ] **Step 4: Run to verify they pass**

Run: `bun test --path-ignore-patterns '' tests/stories/harness/scripted-llm.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/stories/harness/scripted-llm.ts tests/stories/harness/scripted-llm.test.ts
git commit -m "test(stories): resolve compaction handles in scripted tool input"
```

---

### Task 5: Command-surface story file (14 scenarios)

**Files:**

- Create: `tests/stories/commands/surface.story.test.ts`

Every scenario dispatches through the real registered command handlers via `when.message(user, ctx, '/cmd …')`. Import pattern (mirror `tests/stories/context/thread-scope.story.test.ts`):

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { scenario } from '../harness/scenario.js'
import { answer, callCapability, gateCall, promptTextFingerprint } from '../harness/scripted-llm.js'
```

Write the full file with these scenarios — the scenario names below are the catalog story-id names and must match Task 7's mapping table byte-for-byte.

- [ ] **Step 1: help, start, config, context (4 scenarios, first commit)**

```typescript
scenario('SCN-cmd-help: shows user help and the admin appendix', async ({ given, when, then }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  const bob = given.user('bob')
  given.admin(bob)
  const bobDm = given.dm(bob)

  await when.message(alice, dm, '/help')
  then
    .replyTo(alice)
    .equals(
      [
        'papai — AI assistant for Kaneo task management',
        '',
        'Commands:',
        '/help — Show this message',
        '/config — Open your settings in the web UI (single-use link)',
        '/clear — Clear conversation history and memory',
        '/context — Show current memory context (summary and known entities)',
        '/stop — Stop or steer the running task (send again to stop immediately)',
        '',
        'Any other message is sent to the AI assistant.',
      ].join('\n'),
    )

  await when.message(bob, bobDm, '/help')
  then.replyTo(bob).contains('Admin commands:')
  then.replyTo(bob).contains('/dashboard — Open the operator dashboard (single-use link)')
})

scenario('SCN-cmd-start: welcomes an authorized user', async ({ given, when, then }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)

  await when.message(alice, dm, '/start')

  then.replyTo(alice).contains('Welcome to papai!')
  then.replyTo(alice).contains('/config')
})

scenario('SCN-cmd-config-dm: issues a single-use settings link in DM', async ({ given, when, then }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)

  await when.message(alice, dm, '/config')

  then.replyTo(alice).contains('Open your settings:')
  then.replyTo(alice).contains('single-use and expires in 10 minutes')
})

scenario('SCN-cmd-config-group: redirects group admins and refuses plain members', async ({ given, when, then }) => {
  const carol = given.user('carol')
  const dave = given.user('dave')
  const team = given.group('team')
  given.member(team, carol)
  given.member(team, dave)
  given.groupAdmin(team, carol)

  await when.message(carol, team, '/config')
  then
    .replyTo(carol)
    .equals('Group settings are configured in direct messages with the bot. Open a DM with me and run /config.')

  await when.message(dave, team, '/config')
  then
    .replyTo(dave)
    .equals(
      'Only group admins can configure group settings, and group settings are configured in direct messages with the bot.',
    )
})
```

- [ ] **Step 2: context and clear family (5 scenarios)**

`SCN-cmd-context` asserts the rendered snapshot (`renderContext` returns JSON text in the scenario chat) contains stable behavioral fragments — run the scenario once to inspect the actual snapshot, then pin `contains` on the seeded identity and one structural key. Do NOT snapshot-assert the full JSON (spec: no broad snapshots):

```typescript
scenario('SCN-cmd-context: renders the memory context snapshot', async ({ given, when, then }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  given.identity(alice, { providerUserId: 'alice-kaneo', login: 'alice' })

  await when.message(alice, dm, '/context')

  then.replyTo(alice).contains('alice-kaneo')
})
```

(If the real collector does not surface identities into the snapshot, replace the fragment with the structural empty-state fragment found during the run — e.g. `'"summary":null'` — and note the choice in the commit message. The scenario must keep at least one behavioral fragment assertion.)

```typescript
scenario('SCN-cmd-clear-self: clears own history, memory, and facts', async ({ given, when, then, world }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  given.llm([answer('first reply')])

  await when.message(alice, dm, 'remember this phrase')
  then.replyTo(alice).equals('first reply')

  await when.message(alice, dm, '/clear')
  then.replyTo(alice).equals('Conversation history, memory, and facts cleared.')

  given.llm([answer('second reply')])
  await when.message(alice, dm, 'hello again')
  then.replyTo(alice).equals('second reply')
  const last = world.model.inspections().at(-1)
  expect(last?.promptTextFingerprints).not.toContain(promptTextFingerprint('remember this phrase'))
})

scenario('SCN-cmd-clear-target-user: an admin clears another user', async ({ given, when, then }) => {
  const alice = given.user('alice')
  const bob = given.user('bob')
  given.admin(bob)
  const bobDm = given.dm(bob)

  await when.message(bob, bobDm, '/clear alice')

  then.replyTo(bob).equals('Cleared history, memory, and facts for user alice.')
})

scenario('SCN-cmd-clear-all: a super admin clears every user', async ({ given, when, then }) => {
  const alice = given.user('alice')
  const bob = given.user('bob')
  given.admin(bob, { superAdmin: true })
  const bobDm = given.dm(bob)

  await when.message(bob, bobDm, '/clear all')

  then.replyTo(bob).equals('Cleared history, memory, and facts for all 1 users.')
})

scenario('SCN-cmd-clear-group-denied: a plain group member cannot clear', async ({ given, when, then }) => {
  const alice = given.user('alice')
  const team = given.group('team')
  given.member(team, alice)

  await when.message(alice, team, '/clear')

  then.replyTo(alice).equals('Only group admins can run this command.')
})
```

(In clear-all, `1` is the authorized-user count: only alice is authorized; bob's admin row is not a user. Verify at runtime; adjust the count in the assertion if the real `listUsers()` result differs, and say why in the commit message.)

- [ ] **Step 3: dashboard, stop-noop, acp (3 scenarios)**

```typescript
scenario('SCN-cmd-dashboard: reports the dashboard disabled without DEBUG_SERVER', async ({ given, when, then }) => {
  const bob = given.user('bob')
  given.admin(bob)
  const bobDm = given.dm(bob)

  await when.message(bob, bobDm, '/dashboard')
  then.replyTo(bob).equals('The dashboard is disabled on this deployment (DEBUG_SERVER is not enabled).')

  const team = given.group('team')
  given.member(team, bob)
  await when.message(bob, team, '/dashboard')
  then.replyTo(bob).equals('Open this in a DM with me — `/dashboard` is DM-only.')
})

scenario('SCN-cmd-stop-noop: reports nothing running', async ({ given, when, then }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)

  await when.message(alice, dm, '/stop')

  then.replyTo(alice).equals('Nothing is running right now.')
})
```

`SCN-cmd-acp` mirrors the plugin activation setup of `tests/stories/integrations/runtime-extensions/command-prompt.story.test.ts` — read it and reuse its `given.*` arrangement for an eligible context (it uses a runtime extension or plugin fixture), then:

```typescript
scenario(
  'SCN-cmd-acp: shows ACP help in an eligible context and refuses a disabled one',
  async ({ given, when, then }) => {
    // mirror command-prompt.story.test.ts setup for an eligible context with the acp plugin active
    // eligible context:
    await when.message(user, eligibleContext, '/plugin_acp_acp')
    then
      .replyTo(user)
      .equals(
        'ACP coding sessions are available. Ask me in natural language, e.g. "start a session on demo to add a ' +
          'health check", "what sessions are running?", "review PR 42 on demo", or "continue PR 42 on demo and fix ' +
          'the failing tests".',
      )
    // disabled context (second group with the plugin disabled for it — mirror the ineligible half of command-prompt):
    await when.message(user, disabledContext, '/plugin_acp_acp')
    then.replyTo(user).equals('Plugin `acp` is disabled for this context.')
  },
)
```

(Fill in the setup lines from the mirrored story — same fixtures, same eligibility toggles. This scenario is the command-surface view; the integrations story keeps the extension-registration view.)

- [ ] **Step 4: stop-graceful and stop-abort (2 scenarios)**

```typescript
scenario(
  'SCN-cmd-stop-graceful: first stop winds down after the current step',
  async ({ given, when, then, world }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    given.taskInstance()
    given.llm([gateCall('tasks.create', { title: 'Long task' })])

    const gatePromise = world.model.nextGate()
    await when.dispatchMessage(alice, dm, 'Create a long task')
    const gate = await gatePromise

    await when.dispatchMessage(alice, dm, '/stop')
    then.replyTo(alice).equals('🛑 winding down after this step…')

    gate.release()
    await world.settle()

    then.repliesTo(alice).equal(['🛑 winding down after this step…', '🛑 Stopped. Completed 1 action: create_task.'])
  },
)

scenario('SCN-cmd-stop-abort: second stop aborts immediately', async ({ given, when, then, world }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  given.taskInstance()
  given.llm([gateCall('tasks.create', { title: 'Long task' })])

  const gatePromise = world.model.nextGate()
  await when.dispatchMessage(alice, dm, 'Create a long task')
  const gate = await gatePromise

  await when.dispatchMessage(alice, dm, '/stop')
  await when.dispatchMessage(alice, dm, '/stop')
  then.repliesTo(alice).equal(['🛑 winding down after this step…', '🛑 Stopping immediately…'])

  await world.settle()

  then
    .repliesTo(alice)
    .equal([
      '🛑 winding down after this step…',
      '🛑 Stopping immediately…',
      '🛑 Stopped immediately. An in-flight action may have been cut off — verify recent changes.',
    ])
})
```

(In abort, the gate is never released: the abort fires the scripted model's abort listener, which rejects the parked generation and clears the pending tool call, so `world.verify()` passes. The forced summary has zero completed effects because the tool never executed.)

- [ ] **Step 5: Run the story file**

Run: `bun test:stories`
Expected: the 14 new scenarios pass; previously green stories stay green.

- [ ] **Step 6: Commit**

```bash
git add tests/stories/commands/surface.story.test.ts
git commit -m "test(stories): cover the command surface end to end"
```

---

### Task 6: Meta-tools story file (3 scenarios) + `search_tools` registration

**Files:**

- Create: `tests/stories/meta/disclosure-and-compaction.story.test.ts`
- Modify: `src/llm-orchestrator-tools.ts:230` (register `meta.search-tools`)

- [ ] **Step 1: Write the story file (RED — `meta.search-tools` cannot resolve yet)**

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { scenario } from '../harness/scenario.js'
import { answer, callCapability, promptTextFingerprint } from '../harness/scripted-llm.js'

scenario(
  'SCN-meta-search-tools: ranks tools lexically through the real search_tools tool',
  async ({ given, when, then, world }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    given.taskInstance()
    given.llm([callCapability('meta.search-tools', { query: 'create task' }), answer('You can use create_task.')])

    await when.message(alice, dm, 'How do I make a task?')

    then.replyTo(alice).equals('You can use create_task.')
    const second = world.model.inspections().at(1)
    expect(second?.promptTokenFingerprints).toContain(promptTextFingerprint('create_task'))
  },
)

scenario('SCN-meta-load-tool: loads a non-advertised tool before calling it', async ({ given, when, then, world }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  given.taskInstance()
  given.llm([callCapability('tasks.create', { title: 'Release 8' }), answer('Created “Release 8”.')])

  await when.message(alice, dm, 'Create task Release 8')

  then.replyTo(alice).equals('Created “Release 8”.')
  const [first, second] = world.model.inspections()
  expect(first?.availableTools).toContain('load_tool')
  expect(first?.availableTools).not.toContain('create_task')
  expect(second?.availableTools).toContain('create_task')
})

scenario('SCN-meta-expand-result: expands a compacted tool result by handle', async ({ given, when, then, world }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  given.taskInstance()
  const big = 'payload-'.repeat(1200)
  given.llm([callCapability('tasks.create', { title: 'Big task', description: big }), answer('Created the big task.')])

  await when.message(alice, dm, 'Create a task with a huge description')
  then.replyTo(alice).equals('Created the big task.')

  given.llm([
    callCapability('tasks.list', {}),
    callCapability('meta.expand-result', { handle: '$compaction:latest', limit: 4000 }),
    answer('The description starts with payload-payload.'),
  ])
  await when.message(alice, dm, 'Show me the big task description')

  then.replyTo(alice).equals('The description starts with payload-payload.')
  // Generation walk (turn 1: load/create/answer = 3 gens; turn 2: load/list/load/expand/answer = 5 gens).
  // The compacted envelope first appears in the gen after the list call (index 5 overall = at(-3));
  // the expanded chunk appears in the final answer generation's prompt (at(-1)).
  const inspections = world.model.inspections()
  const afterList = inspections.at(-3)
  expect(afterList?.promptTokenFingerprints).toContain(promptTextFingerprint('_compacted'))
  const answerGeneration = inspections.at(-1)
  expect(answerGeneration?.promptTokenFingerprints).toContain(promptTextFingerprint('payload'))
})
```

- [ ] **Step 2: Run to verify RED**

Run: `bun test:stories` (or the fixture-filtered run)
Expected: `SCN-meta-search-tools` FAILS with `Could not resolve capability 'meta.search-tools'` — this proves the production seam is the missing piece. The other two scenarios pass.

- [ ] **Step 3: Register `meta.search-tools` in the disclosure path**

In `src/llm-orchestrator-tools.ts`, inside `buildFullToolSet`, immediately after the `applyCompactionAndDisclosure(...)` call (after line 230), add:

```typescript
toolCapabilityCatalog.register('meta.search-tools', 'search_tools')
```

(`maybeApplyDisclosure` injects `search_tools` unconditionally, so unconditional registration is correct; re-registering the same mapping per turn is idempotent.)

- [ ] **Step 4: Run to verify GREEN**

Run: `bun test:stories`
Expected: all 3 meta scenarios pass; the full suite is green.

- [ ] **Step 5: Commit**

```bash
git add tests/stories/meta/disclosure-and-compaction.story.test.ts src/llm-orchestrator-tools.ts
git commit -m "test(stories): cover meta tools and register search_tools capability"
```

---

### Task 7: Ledger update — 17 mappings, audit removal, totals

**Files:**

- Modify: `tests/stories/catalog/coverage.ts` (`AUDIT_RECORDS`, `EXECUTABLE_STORY_MAPPINGS`)
- Test: `tests/stories/harness/catalog-coverage.test.ts`, `tests/scripts/story-coverage-totals.test.ts`

- [ ] **Step 1: Update the failing contract tests first**

In `tests/stories/harness/catalog-coverage.test.ts`:

1. `tracks the executable coverage total`: change `32` to `49`.
2. `audit records cover exactly the pending scenarios`: change `96` to `79`.
3. `audit readiness totals match the audit outcome`: change the three expected counts to `5`, `52`, `22`.
4. In `tests/scripts/story-coverage-totals.test.ts`, change both assertions to:

```typescript
expect(storyCoverageTotals()).toEqual({
  total: 128,
  executable: 49,
  pending: 79,
  readiness: { 'executable-as-is': 5, 'needs-seam': 52, blocked: 22 },
})
```

and the format string to `'story catalog: 49/128 executable; pending 79 (5 executable-as-is, 52 needs-seam, 22 blocked)'`.

- [ ] **Step 2: Run to verify they fail**

Run: `bun test --path-ignore-patterns '' tests/stories/harness/catalog-coverage.test.ts && bun test tests/scripts/story-coverage-totals.test.ts`
Expected: FAIL — counts are stale.

- [ ] **Step 3: Move the 17 entries**

In `tests/stories/catalog/coverage.ts`:

1. Delete these 17 entries from `AUDIT_RECORDS`: all `SCN-cmd-*` except `SCN-cmd-nerv` and `SCN-cmd-announce` (14 entries), plus `SCN-meta-expand-result`, `SCN-meta-search-tools`, `SCN-meta-load-tool`.
2. Add to `EXECUTABLE_STORY_MAPPINGS` (story-id strings must match the scenario names in Tasks 5–6 exactly):

```typescript
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
    storyIds: ['tests/stories/commands/surface.story.test.ts#SCN-cmd-config-dm: issues a single-use settings link in DM'],
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
    storyIds: ['tests/stories/commands/surface.story.test.ts#SCN-cmd-clear-group-denied: a plain group member cannot clear'],
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
```

- [ ] **Step 4: Run the ledger tests to verify they pass**

Run: `bun test --path-ignore-patterns '' tests/stories/harness/catalog-coverage.test.ts && bun test tests/scripts/story-coverage-totals.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/stories/catalog/coverage.ts tests/stories/harness/catalog-coverage.test.ts tests/scripts/story-coverage-totals.test.ts
git commit -m "test(stories): map F1 command and meta scenarios in the catalog"
```

---

### Task 8: Final verification gate

- [ ] **Step 1: Sandboxed story suite**

Run: `bun test:stories`
Expected: 57 pass / 0 fail (40 previous + 17 new).

- [ ] **Step 2: Sandboxed contract suites**

Run: `bun test:stories:contracts`
Expected: all pass.

- [ ] **Step 3: Runner and touched unit suites**

Run: `bun test tests/scripts/ tests/tools/core-capabilities.test.ts`
Expected: all pass.

- [ ] **Step 4: Typecheck and lint**

Run: `bun run typecheck && bun run lint`
Expected: clean.

- [ ] **Step 5: Fresh manifest, totals line, compat**

Run: `bun test:stories:manifest 2>&1 | grep "story catalog"` — expect `story catalog: 49/128 executable; pending 79 (5 executable-as-is, 52 needs-seam, 22 blocked)`; manifest scenario count is 58 (41 + 17).
Run: `git status --short` (clean), then `bun scripts/story/test-stories.ts --compat --baseline-ref HEAD --manifest-only`
Expected: exit 0.

## Execution learnings (2026-07-19)

- `clear-all` count shipped as `2`, not `1`: `given.admin(bob)` also creates bob's user row.
- `cmd-context` pins structural snapshot fragments (`modelName`, `label`, `detail`); seeded identities never surface in the collector's snapshot.
- Group replies are context-keyed: use `then.replyIn(group)`, never `then.replyTo(user)`, in group scenarios.
- `promptTokenFingerprints` see text parts only; tool-result content needs `promptToolResultTokenFingerprints` (added post-review).
- Stop scenarios need the disclosure walk (`load_tool` first) scripted before the gate; summaries include `load_tool` in completed effects.
