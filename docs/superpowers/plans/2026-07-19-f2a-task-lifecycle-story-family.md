<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# F2a Task Lifecycle and Policy Story Family Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the 9 lifecycle/policy `task-*` scenarios real, moving the catalog ledger from 49 to 58 executable stories.

**Architecture:** Production capability-id additions (14 entries), three honest MemoryTaskProvider method groups (delete/count/history with self-seeding activities), two small DSL additions (`given.toolPrefs`, `then.task.absent()`), then one 9-scenario story file, then the ledger update.

**Tech Stack:** Bun, TypeScript (strict), bun:test.

**Spec:** `docs/superpowers/specs/2026-07-19-f2a-task-lifecycle-story-family-design.md`

**Ledger after this plan:** 128 ids, 58 executable, 70 pending (2 `executable-as-is`, 46 `needs-seam`, 22 `blocked`). Story suite: 57 → 66.

**Frozen-tree note:** this plan changes frozen inputs (harness, catalog). Re-record the compat baseline after landing. Stories run sandboxed (`bun test:stories`, Docker required); harness contract suites run via `bun test:stories:contracts`; direct runs of contract files need `bun test --path-ignore-patterns '' <file>`.

**Execution learnings carried from F1 (apply throughout):** stories need `given.assign(dm, instance)` for task tools to exist; `create_task` requires `projectId`; group replies need `then.replyIn`; `given.*` closes at world start (seed everything before the first `when`); pure command flows need no `given.llm`; the first capability call in a turn routes through an automatic `load_tool` hop — generation indices in assertions must account for it; `promptTokenFingerprints` see text parts only, `promptToolResultTokenFingerprints` see tool-result content.

---

### Task 1: Task capability ids (production)

**Files:**

- Modify: `src/tools/core-capabilities.ts`
- Test: `tests/tools/core-capabilities.test.ts`

- [ ] **Step 1: Update the failing test first**

In `tests/tools/core-capabilities.test.ts`, update the `registers the stable core capabilities when their real wire tools are offered` test's expected entries to (order matters — insertion order of `CORE_TOOL_CAPABILITIES`):

```typescript
expect(catalog.entries()).toEqual([
  ['tasks.create', 'create_task'],
  ['tasks.get', 'get_task'],
  ['tasks.list', 'list_tasks'],
  ['tasks.search', 'search_tasks'],
  ['meta.expand-result', 'expand_result'],
  ['tasks.update', 'update_task'],
  ['tasks.delete', 'delete_task'],
  ['tasks.count', 'count_tasks'],
  ['tasks.history', 'get_task_history'],
  ['tasks.comments.list', 'get_comments'],
  ['tasks.comments.create', 'add_comment'],
  ['tasks.comments.update', 'update_comment'],
  ['tasks.comments.delete', 'remove_comment'],
  ['tasks.labels.list', 'list_labels'],
  ['tasks.labels.create', 'create_label'],
  ['tasks.labels.update', 'update_label'],
  ['tasks.labels.delete', 'remove_label'],
  ['tasks.labels.assign', 'add_task_label'],
  ['tasks.labels.unassign', 'remove_task_label'],
])
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/tools/core-capabilities.test.ts`
Expected: FAIL — actual entries lack the 14 new mappings.

- [ ] **Step 3: Add the entries**

In `src/tools/core-capabilities.ts`, append after the `'meta.expand-result'` entry (keep this exact order):

```typescript
export const CORE_TOOL_CAPABILITIES = Object.freeze({
  'tasks.create': 'create_task',
  'tasks.get': 'get_task',
  'tasks.list': 'list_tasks',
  'tasks.search': 'search_tasks',
  'meta.expand-result': 'expand_result',
  'tasks.update': 'update_task',
  'tasks.delete': 'delete_task',
  'tasks.count': 'count_tasks',
  'tasks.history': 'get_task_history',
  'tasks.comments.list': 'get_comments',
  'tasks.comments.create': 'add_comment',
  'tasks.comments.update': 'update_comment',
  'tasks.comments.delete': 'remove_comment',
  'tasks.labels.list': 'list_labels',
  'tasks.labels.create': 'create_label',
  'tasks.labels.update': 'update_label',
  'tasks.labels.delete': 'remove_label',
  'tasks.labels.assign': 'add_task_label',
  'tasks.labels.unassign': 'remove_task_label',
} as const)
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test tests/tools/core-capabilities.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/core-capabilities.ts tests/tools/core-capabilities.test.ts
git commit -m "feat(tools): register task lifecycle capabilities"
```

---

### Task 2: MemoryTaskProvider — delete, count, self-seeding history

**Files:**

- Modify: `tests/stories/harness/memory-task-provider.ts`
- Test: `tests/stories/harness/memory-task-provider.test.ts`

Semantics (contract-tested): `deleteTask` removes the task plus its comments, label assignments, and history (`Task not found: <id>` convention, `task.delete` event); `countTasks` reuses search semantics; `getTaskHistory` returns activities the provider records itself on every mutating operation (create/update/delete, comment create/update/delete, task-label add/remove), with category/author/limit/offset/reverse filtering and a loud error on `start`/`end` (counter timestamps are not dates — silent ignoring would be dishonest).

- [ ] **Step 1: Write the failing contract tests**

In `tests/stories/harness/memory-task-provider.test.ts`, add (following the file's existing setup pattern):

```typescript
describe('deleteTask', () => {
  test('removes the task with its comments, labels, and history', async () => {
    const provider = new MemoryTaskProvider()
    const task = await provider.createTask({ projectId: 'proj-1', title: 'Doomed' })
    await provider.addComment(task.id, 'note')
    const label = await provider.createLabel({ name: 'urgent' })
    await provider.addTaskLabel(task.id, label.id)

    await expect(provider.deleteTask(task.id)).resolves.toEqual({ id: task.id })
    await expect(provider.getTask(task.id)).rejects.toThrow(`Task not found: ${task.id}`)
    await expect(provider.getComments(task.id)).rejects.toThrow(`Task not found: ${task.id}`)
    await expect(provider.listTaskLabels(task.id)).rejects.toThrow(`Task not found: ${task.id}`)
    await expect(provider.getTaskHistory(task.id)).rejects.toThrow(`Task not found: ${task.id}`)
  })

  test('rejects a missing task', async () => {
    const provider = new MemoryTaskProvider()

    await expect(provider.deleteTask('task-404')).rejects.toThrow('Task not found: task-404')
  })
})

describe('countTasks', () => {
  test('counts search matches with query and project filters', async () => {
    const provider = new MemoryTaskProvider()
    await provider.createTask({ projectId: 'proj-1', title: 'Release 7' })
    await provider.createTask({ projectId: 'proj-1', title: 'Release 8' })
    await provider.createTask({ projectId: 'proj-2', title: 'Release 9' })
    await provider.createTask({ projectId: 'proj-1', title: 'Backlog grooming' })

    await expect(provider.countTasks({ query: 'release' })).resolves.toBe(3)
    await expect(provider.countTasks({ query: 'release', projectId: 'proj-1' })).resolves.toBe(2)
    await expect(provider.countTasks({ query: 'grooming' })).resolves.toBe(1)
  })
})

describe('getTaskHistory', () => {
  test('self-seeds activities from mutating operations with filtering and ordering', async () => {
    const provider = new MemoryTaskProvider()
    const task = await provider.createTask({ projectId: 'proj-1', title: 'Tracked' })
    await provider.updateTask(task.id, { title: 'Tracked harder' })
    await provider.addComment(task.id, 'first')

    const history = await provider.getTaskHistory(task.id)
    expect(history.map((entry) => entry.category)).toEqual(['task.created', 'task.updated', 'comment.created'])
    expect(history[1]).toMatchObject({ field: 'title', added: 'Tracked harder' })

    await expect(provider.getTaskHistory(task.id, { categories: ['task.updated'] })).resolves.toHaveLength(1)
    const reversed = await provider.getTaskHistory(task.id, { reverse: true })
    expect(reversed.map((entry) => entry.category)).toEqual(['comment.created', 'task.updated', 'task.created'])
    await expect(provider.getTaskHistory(task.id, { limit: 1, offset: 1 })).resolves.toHaveLength(1)
  })

  test('rejects start/end filtering loudly', async () => {
    const provider = new MemoryTaskProvider()
    const task = await provider.createTask({ projectId: 'proj-1', title: 'Tracked' })

    await expect(provider.getTaskHistory(task.id, { start: '2026-01-01' })).rejects.toThrow(
      'MemoryTaskProvider does not support start/end history filtering',
    )
  })
})

describe('capabilities', () => {
  test('accepts the lifecycle capabilities', () => {
    const provider = new MemoryTaskProvider()

    expect(() => provider.setCapabilities(['tasks.delete', 'tasks.count', 'activities.read'])).not.toThrow()
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test --path-ignore-patterns '' tests/stories/harness/memory-task-provider.test.ts`
Expected: FAIL — `deleteTask`/`countTasks`/`getTaskHistory` are not functions; `setCapabilities` throws for the new capabilities.

- [ ] **Step 3: Implement the methods**

In `tests/stories/harness/memory-task-provider.ts`:

1. Extend `supportedMemoryTaskCapabilities` with `'tasks.delete'`, `'tasks.count'`, `'activities.read'`.
2. Add state next to the existing maps:

```typescript
  private readonly history = new Map<string, Activity[]>()
  private activitySequence = 0
```

(`Activity` is imported from `../../../src/providers/types.js` — the types module re-exports the domain types; add it to the existing type import.)

3. Add a private recorder and call it from every mutating method:

```typescript
  private recordActivity(taskId: string, entry: Readonly<Omit<Activity, 'id' | 'timestamp'>>): void {
    this.activitySequence += 1
    const activity: Activity = { id: `activity-${this.activitySequence}`, timestamp: String(this.activitySequence), ...entry }
    const entries = this.history.get(taskId) ?? []
    entries.push(clone(activity))
    this.history.set(taskId, entries)
  }
```

Call sites: `createTask` → `{ category: 'task.created' }`; `updateTask` → one activity per patched field `{ category: 'task.updated', field, added }` where `added` is the value itself when it is a string, otherwise `JSON.stringify(value)` (dueDate and similar non-string fields must not become `[object Object]`); `deleteTask` → `{ category: 'task.deleted' }` (recorded before the maps are cleared); `addComment` → `{ category: 'comment.created' }`; `updateComment` → `{ category: 'comment.updated', field: 'comment' }`; `removeComment` → `{ category: 'comment.deleted' }`; `addTaskLabel` → `{ category: 'task.label.added', field: 'label', added: labelId }`; `removeTaskLabel` → `{ category: 'task.label.removed', field: 'label', removed: labelId }`.

4. Add the three methods (placed near `updateTask`/`searchTasks`):

```typescript
  deleteTask(taskId: string): Promise<{ id: string }> {
    return Promise.resolve().then(() => {
      this.requireTask(taskId)
      this.recordActivity(taskId, { category: 'task.deleted' })
      this.tasks.delete(taskId)
      this.comments.delete(taskId)
      this.taskLabelIds.delete(taskId)
      this.history.delete(taskId)
      this.events?.record('task.delete', { taskId })
      return { id: taskId }
    })
  }

  countTasks(params: Readonly<{ query: string; projectId?: string }>): Promise<number> {
    return Promise.resolve().then(async () => (await this.searchTasks({ ...params })).length)
  }

  getTaskHistory(
    taskId: string,
    params: Readonly<{
      categories?: string[]
      limit?: number
      offset?: number
      reverse?: boolean
      start?: string
      end?: string
      author?: string
    }> = {},
  ): Promise<Activity[]> {
    return Promise.resolve().then(() => {
      this.requireTask(taskId)
      if (params.start !== undefined || params.end !== undefined) {
        throw new Error('MemoryTaskProvider does not support start/end history filtering')
      }
      const entries = [...(this.history.get(taskId) ?? [])]
      const filtered = entries
        .filter((entry) => params.categories === undefined || params.categories.includes(entry.category))
        .filter((entry) => params.author === undefined || entry.author === params.author)
      const ordered = params.reverse === true ? filtered.reverse() : filtered
      const offset = Math.max(0, params.offset ?? 0)
      const limit = params.limit ?? ordered.length
      const result = ordered.slice(offset, offset + limit)
      this.events?.record('task.history', { taskId, count: result.length })
      return clone(result)
    })
  }
```

(The history map is deleted with the task in `deleteTask`, so the recorded `task.deleted` activity is a transient breadcrumb for the in-flight call only — that is intentional; history dies with its task.)

- [ ] **Step 4: Run to verify they pass**

Run: `bun test --path-ignore-patterns '' tests/stories/harness/memory-task-provider.test.ts`
Expected: PASS (new and existing tests).

- [ ] **Step 5: Commit**

```bash
git add tests/stories/harness/memory-task-provider.ts tests/stories/harness/memory-task-provider.test.ts
git commit -m "test(stories): add delete, count, and self-seeding history to the memory provider"
```

---

### Task 3: `given.toolPrefs` and `then.task(title).absent()`

**Files:**

- Modify: `tests/stories/harness/scenario.ts`
- Test: `tests/stories/harness/scenario.test.ts`

- [ ] **Step 1: Write the failing contract test**

In `tests/stories/harness/scenario.test.ts`, add a mini-scenario (following the file's existing pattern):

```typescript
test('given.toolPrefs gates the advertised toolset and then.task.absent passes for missing tasks', async () => {
  await executeScenario('tool prefs fixture', async ({ given, when, then, world }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    const instance = given.taskInstance()
    given.assign(dm, instance)
    given.toolPrefs(dm, { riskDefaults: {}, domainDefaults: {}, toolOverrides: { create_task: 'deny' } })
    given.llm([answer('cannot create')])

    await when.message(alice, dm, 'Create task Nope')

    then.replyTo(alice).equals('cannot create')
    const last = world.model.inspections().at(-1)
    expect(last?.availableTools).not.toContain('create_task')
    expect(last?.availableTools).toContain('list_tasks')
    await then.task('Nope').absent()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test --path-ignore-patterns '' tests/stories/harness/scenario.test.ts`
Expected: FAIL — `given.toolPrefs` and `then.task(...).absent` are not functions.

- [ ] **Step 3: Implement both additions**

In `tests/stories/harness/scenario.ts`:

1. Import `setToolPrefs` from `../../../src/tools/tool-preferences.js` and the prefs type it accepts.
2. Add to `ScenarioGiven` (type + `createGiven` impl):

```typescript
    toolPrefs(context: ContextHandle, prefs: ToolPrefs): void {
      prerequisite('given.toolPrefs')
      setToolPrefs(scopedConfigContextId(context), prefs)
    },
```

(`ToolPrefs` — use the exact type `setToolPrefs` accepts, imported from the same module; `scopedConfigContextId` already exists at scenario.ts:190-191.)

3. Extend the `then.task` assertion (at :524-529):

```typescript
    task: (title) => ({
      async exists(): Promise<void> {
        const matches = await world.tasks.searchTasks({ query: title })
        tracedAssertion(world, () => expect(matches.some((task) => task.title === title)).toBe(true))
      },
      async absent(): Promise<void> {
        const matches = await world.tasks.searchTasks({ query: title })
        tracedAssertion(world, () => expect(matches.some((task) => task.title === title)).toBe(false))
      },
    }),
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test --path-ignore-patterns '' tests/stories/harness/scenario.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/stories/harness/scenario.ts tests/stories/harness/scenario.test.ts
git commit -m "test(stories): add toolPrefs fixture and task absent assertion"
```

---

### Task 4: Lifecycle and policy story file (9 scenarios)

**Files:**

- Create: `tests/stories/tasks/lifecycle-and-policy.story.test.ts`

All DM contexts with an assigned instance: `const instance = given.taskInstance(); given.assign(dm, instance)`. The memory provider has no project store — use a stable project id literal `'proj-1'` everywhere. Deterministic ids: first task is `task-1`, first comment `comment-1`, first label `label-1` (fresh world per scenario). Header/imports mirror the commands story file. Scenario names must match the Task 5 mapping table byte-for-byte.

- [ ] **Step 1: create-update, query, delete (3 scenarios)**

```typescript
scenario('SCN-task-create-update: creates and renames a task through the tool loop', async ({ given, when, then }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  const instance = given.taskInstance()
  given.assign(dm, instance)
  given.llm([
    callCapability('tasks.create', { projectId: 'proj-1', title: 'Release 7' }),
    answer('Created “Release 7”.'),
  ])

  await when.message(alice, dm, 'Create task Release 7')
  then.replyTo(alice).equals('Created “Release 7”.')

  given.llm([
    callCapability('tasks.update', { taskId: 'task-1', title: 'Release 8' }),
    answer('Renamed to “Release 8”.'),
  ])
  await when.message(alice, dm, 'Rename it to Release 8')

  then.replyTo(alice).equals('Renamed to “Release 8”.')
  await then.task('Release 8').exists()
  await then.task('Release 7').absent()
})

scenario('SCN-task-query: counts and lists tasks with project filters', async ({ given, when, then, world }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  const instance = given.taskInstance()
  given.assign(dm, instance)
  given.llm([
    callCapability('tasks.create', { projectId: 'proj-1', title: 'Alpha' }),
    callCapability('tasks.create', { projectId: 'proj-1', title: 'Beta' }),
    callCapability('tasks.create', { projectId: 'proj-2', title: 'Gamma' }),
    answer('Seeded three tasks.'),
  ])

  await when.message(alice, dm, 'Set up the demo tasks')

  given.llm([
    callCapability('tasks.count', { query: 'a' }),
    callCapability('tasks.list', { projectId: 'proj-1' }),
    answer('3 tasks match; 2 are in proj-1.'),
  ])
  await when.message(alice, dm, 'How many tasks and what is in proj-1?')

  then.replyTo(alice).equals('3 tasks match; 2 are in proj-1.')
  const creates = world.events.all().filter((event) => event.kind === 'task.create')
  expect(creates).toHaveLength(3)
})

scenario('SCN-task-delete: deletes with confidence and refuses without it', async ({ given, when, then }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  const instance = given.taskInstance()
  given.assign(dm, instance)
  given.llm([callCapability('tasks.create', { projectId: 'proj-1', title: 'Doomed' }), answer('Created “Doomed”.')])

  await when.message(alice, dm, 'Create task Doomed')

  given.llm([
    callCapability('tasks.delete', { taskId: 'task-1', confidence: 0.5 }),
    answer('I need your confirmation to delete “Doomed”.'),
  ])
  await when.message(alice, dm, 'Delete the task')
  then.replyTo(alice).equals('I need your confirmation to delete “Doomed”.')
  await then.task('Doomed').exists()

  given.llm([callCapability('tasks.delete', { taskId: 'task-1', confidence: 0.9 }), answer('Deleted “Doomed”.')])
  await when.message(alice, dm, 'Really, delete it')

  then.replyTo(alice).equals('Deleted “Doomed”.')
  await then.task('Doomed').absent()
})
```

- [ ] **Step 2: history, comments, labels (3 scenarios)**

```typescript
scenario('SCN-task-history: reads self-seeded task activities', async ({ given, when, then, world }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  const instance = given.taskInstance()
  given.assign(dm, instance)
  given.llm([
    callCapability('tasks.create', { projectId: 'proj-1', title: 'Tracked' }),
    callCapability('tasks.update', { taskId: 'task-1', title: 'Tracked harder' }),
    answer('Created and renamed.'),
  ])

  await when.message(alice, dm, 'Create Tracked then rename it')

  given.llm([
    callCapability('tasks.history', { taskId: 'task-1' }),
    answer('It was created, then renamed to “Tracked harder”.'),
  ])
  await when.message(alice, dm, 'What happened to the task?')

  then.replyTo(alice).equals('It was created, then renamed to “Tracked harder”.')
  const last = world.model.inspections().at(-1)
  expect(last?.promptToolResultTokenFingerprints).toContain(promptTextFingerprint('created'))
  expect(last?.promptToolResultTokenFingerprints).toContain(promptTextFingerprint('updated'))
})

scenario('SCN-task-comments: adds, edits, and removes a comment', async ({ given, when, then, world }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  const instance = given.taskInstance()
  given.assign(dm, instance)
  given.llm([callCapability('tasks.create', { projectId: 'proj-1', title: 'Discussed' }), answer('Created.')])

  await when.message(alice, dm, 'Create task Discussed')

  given.llm([
    callCapability('tasks.comments.create', { taskId: 'task-1', comment: 'first draft' }),
    callCapability('tasks.comments.list', { taskId: 'task-1' }),
    answer('Comment added.'),
  ])
  await when.message(alice, dm, 'Comment "first draft" on it')
  expect(await world.tasks.getComments('task-1')).toHaveLength(1)

  given.llm([
    callCapability('tasks.comments.update', { taskId: 'task-1', activityId: 'comment-1', comment: 'final edit' }),
    answer('Comment updated.'),
  ])
  await when.message(alice, dm, 'Edit the comment to "final edit"')
  expect((await world.tasks.getComments('task-1')).at(0)?.body).toBe('final edit')

  given.llm([
    callCapability('tasks.comments.delete', { taskId: 'task-1', commentId: 'comment-1' }),
    answer('Comment removed.'),
  ])
  await when.message(alice, dm, 'Remove the comment')
  expect(await world.tasks.getComments('task-1')).toHaveLength(0)
})

scenario('SCN-task-labels: creates and assigns a label by name', async ({ given, when, then, world }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  const instance = given.taskInstance()
  given.assign(dm, instance)
  given.llm([callCapability('tasks.create', { projectId: 'proj-1', title: 'Labeled' }), answer('Created.')])

  await when.message(alice, dm, 'Create task Labeled')

  given.llm([
    callCapability('tasks.labels.create', { name: 'urgent' }),
    callCapability('tasks.labels.assign', { taskId: 'task-1', labelName: 'urgent' }),
    answer('Labeled “urgent”.'),
  ])
  await when.message(alice, dm, 'Label it urgent')

  then.replyTo(alice).equals('Labeled “urgent”.')
  expect((await world.tasks.listTaskLabels('task-1')).map((label) => label.name)).toEqual(['urgent'])

  given.llm([
    callCapability('tasks.labels.unassign', { taskId: 'task-1', labelName: 'urgent' }),
    answer('Label removed.'),
  ])
  await when.message(alice, dm, 'Unlabel it')
  expect(await world.tasks.listTaskLabels('task-1')).toHaveLength(0)
})
```

- [ ] **Step 3: not-configured, ask-confirm, deny (3 scenarios)**

```typescript
scenario(
  'SCN-task-not-configured: refuses task work without an assigned provider',
  async ({ given, when, then, world }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    given.llm([answer('I cannot manage tasks yet — no task tracker is configured here.')])

    await when.message(alice, dm, 'Create task Nope')

    then.replyTo(alice).equals('I cannot manage tasks yet — no task tracker is configured here.')
    const last = world.model.inspections().at(-1)
    expect(last?.availableTools).not.toContain('create_task')
    expect(last?.availableTools).not.toContain('list_tasks')
  },
)

scenario('SCN-task-ask-confirm: ask permission gates a mutating task tool', async ({ given, when, then, world }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  const instance = given.taskInstance()
  given.assign(dm, instance)
  given.toolPrefs(dm, { riskDefaults: {}, domainDefaults: {}, toolOverrides: { create_task: 'ask' } })
  given.llm([
    callCapability('tasks.create', { projectId: 'proj-1', title: 'Guarded', _permission_reason: 'creates a task' }),
    answer('Created “Guarded”.'),
  ])

  await when.dispatchMessage(alice, dm, 'Create task Guarded')
  const allowCallback = permissionCallback(world, 'perm:a:')
  expect(allowCallback).toBeDefined()
  await when.interaction(alice, dm, allowCallback ?? '')

  then.replyTo(alice).equals('Created “Guarded”.')
  await then.task('Guarded').exists()

  given.llm([
    callCapability('tasks.create', { projectId: 'proj-1', title: 'Refused', _permission_reason: 'creates a task' }),
    answer('I could not create “Refused” without your permission.'),
  ])
  await when.dispatchMessage(alice, dm, 'Create task Refused')
  const denyCallback = permissionCallback(world, 'perm:d:')
  expect(denyCallback).toBeDefined()
  await when.interaction(alice, dm, denyCallback ?? '')

  then.replyTo(alice).equals('I could not create “Refused” without your permission.')
  await then.task('Refused').absent()
})

scenario('SCN-task-deny: denied tools leave the advertised toolset', async ({ given, when, then, world }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  const instance = given.taskInstance()
  given.assign(dm, instance)
  given.toolPrefs(dm, { riskDefaults: {}, domainDefaults: {}, toolOverrides: { create_task: 'deny' } })
  given.llm([answer('I am not allowed to create tasks here.')])

  await when.message(alice, dm, 'Create task Nope')

  then.replyTo(alice).equals('I am not allowed to create tasks here.')
  const last = world.model.inspections().at(-1)
  expect(last?.availableTools).toContain('list_tasks')
  expect(last?.availableTools).not.toContain('create_task')
})
```

Note on the ask scenario's buttons extraction: the scenario chat records the full buttons options on the `buttons` reply. Add this TOP-LEVEL helper to the story file (conditionals are lint-safe at top level; inside scenario bodies they trip `vitest/no-conditional-tests`/`no-conditional-expect`):

```typescript
const permissionCallback = (
  world: Readonly<{ chat: { allReplies(): readonly ScenarioReply[] } }>,
  prefix: string,
): string | undefined =>
  world.chat
    .allReplies()
    .flatMap((reply) => {
      const options = reply.options
      if (options === undefined || !('buttons' in options)) return []
      return options.buttons.map((button) => button.callbackData)
    })
    .find((callbackData) => callbackData.startsWith(prefix))
```

(`ScenarioReply` is exported from `tests/stories/harness/chat.ts` — import it as a type.) The assertion contract is: exactly one `perm:a:<id>` and one `perm:d:<id>` are extractable per prompt. If the captured options shape differs at runtime, adjust the narrow in this helper only and record the actual shape in your report.

- [ ] **Step 4: Run the story file**

Run: `bun test:stories`
Expected: 66 pass / 0 fail (57 + 9).

- [ ] **Step 5: Commit**

```bash
git add tests/stories/tasks/lifecycle-and-policy.story.test.ts
git commit -m "test(stories): cover task lifecycle and tool permission policy"
```

---

### Task 5: Ledger update

**Files:**

- Modify: `tests/stories/catalog/coverage.ts`
- Test: `tests/stories/harness/catalog-coverage.test.ts`, `tests/scripts/story-coverage-totals.test.ts`

- [ ] **Step 1: Update the failing contract tests first**

In `tests/stories/harness/catalog-coverage.test.ts`: `tracks the executable coverage total` 49 → `58`; `audit records cover exactly the pending scenarios` 79 → `70`; `audit readiness totals` → `2`, `46`, `22`.

In `tests/scripts/story-coverage-totals.test.ts`: totals `{ total: 128, executable: 58, pending: 70, readiness: { 'executable-as-is': 2, 'needs-seam': 46, blocked: 22 } }` and format string `'story catalog: 58/128 executable; pending 70 (2 executable-as-is, 46 needs-seam, 22 blocked)'`.

- [ ] **Step 2: Run to verify they fail**

Run: `bun test --path-ignore-patterns '' tests/stories/harness/catalog-coverage.test.ts && bun test tests/scripts/story-coverage-totals.test.ts`
Expected: FAIL — stale counts.

- [ ] **Step 3: Move the 9 entries**

In `tests/stories/catalog/coverage.ts`, delete the 9 F2a entries from `AUDIT_RECORDS` (`SCN-task-create-update`, `-query`, `-delete`, `-history`, `-comments`, `-labels`, `-not-configured`, `-ask-confirm`, `-deny`) and add to `EXECUTABLE_STORY_MAPPINGS` (scenario names must match the story file byte-for-byte — copy them from the file, not from this table):

```typescript
  'SCN-task-create-update': {
    verifiedAt: '2026-07-19',
    storyIds: ['tests/stories/tasks/lifecycle-and-policy.story.test.ts#SCN-task-create-update: creates and renames a task through the tool loop'],
  },
  'SCN-task-query': {
    verifiedAt: '2026-07-19',
    storyIds: ['tests/stories/tasks/lifecycle-and-policy.story.test.ts#SCN-task-query: counts and lists tasks with project filters'],
  },
  'SCN-task-delete': {
    verifiedAt: '2026-07-19',
    storyIds: ['tests/stories/tasks/lifecycle-and-policy.story.test.ts#SCN-task-delete: deletes with confidence and refuses without it'],
  },
  'SCN-task-history': {
    verifiedAt: '2026-07-19',
    storyIds: ['tests/stories/tasks/lifecycle-and-policy.story.test.ts#SCN-task-history: reads self-seeded task activities'],
  },
  'SCN-task-comments': {
    verifiedAt: '2026-07-19',
    storyIds: ['tests/stories/tasks/lifecycle-and-policy.story.test.ts#SCN-task-comments: adds, edits, and removes a comment'],
  },
  'SCN-task-labels': {
    verifiedAt: '2026-07-19',
    storyIds: ['tests/stories/tasks/lifecycle-and-policy.story.test.ts#SCN-task-labels: creates and assigns a label by name'],
  },
  'SCN-task-not-configured': {
    verifiedAt: '2026-07-19',
    storyIds: ['tests/stories/tasks/lifecycle-and-policy.story.test.ts#SCN-task-not-configured: refuses task work without an assigned provider'],
  },
  'SCN-task-ask-confirm': {
    verifiedAt: '2026-07-19',
    storyIds: ['tests/stories/tasks/lifecycle-and-policy.story.test.ts#SCN-task-ask-confirm: ask permission gates a mutating task tool'],
  },
  'SCN-task-deny': {
    verifiedAt: '2026-07-19',
    storyIds: ['tests/stories/tasks/lifecycle-and-policy.story.test.ts#SCN-task-deny: denied tools leave the advertised toolset'],
  },
```

- [ ] **Step 4: Run the ledger tests to verify they pass**

Run: `bun test --path-ignore-patterns '' tests/stories/harness/catalog-coverage.test.ts && bun test tests/scripts/story-coverage-totals.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/stories/catalog/coverage.ts tests/stories/harness/catalog-coverage.test.ts tests/scripts/story-coverage-totals.test.ts
git commit -m "test(stories): map F2a task lifecycle scenarios in the catalog"
```

---

### Task 6: Final verification gate

- [ ] **Step 1: Sandboxed story suite**

Run: `bun test:stories`
Expected: 66 pass / 0 fail.

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

Run: `bun test:stories:manifest 2>&1 | grep "story catalog"` — expect `story catalog: 58/128 executable; pending 70 (2 executable-as-is, 46 needs-seam, 22 blocked)`; manifest scenario count is 67 (58 + 9).
Run: `git status --short` (clean), then `bun scripts/story/test-stories.ts --compat --baseline-ref HEAD --manifest-only`
Expected: exit 0.
