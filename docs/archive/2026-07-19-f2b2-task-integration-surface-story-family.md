<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# F2b-2 Task Integration-Surface Story Family Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the 4 seam-carrying `task-*` scenarios real (`collaboration`, `identity`, `attachments`, `youtrack-command`), completing the task family (21/21) and moving the catalog ledger from 65 to 69 executable stories.

**Architecture:** 12 production capability-id entries, MemoryTaskProvider collaboration + identity methods, attachments provider methods + traits setter + `applyCommand`, a `given.attachment` relay fixture (the in-memory blob store is already installed by the test preload), one 4-scenario story file, ledger update.

**Tech Stack:** Bun, TypeScript (strict), bun:test.

**Spec:** `docs/superpowers/specs/2026-07-19-f2b2-task-integration-surface-story-family-design.md`

**Ledger after this plan:** 128 ids, 69 executable, 59 pending (2 `executable-as-is`, 35 `needs-seam`, 22 `blocked`). Story suite: 73 → 77.

**Frozen-tree note:** this plan changes frozen inputs (harness, catalog). Re-record the compat baseline after landing. Stories run sandboxed (`bun test:stories`, Docker required); contract files run via `bun test --path-ignore-patterns '' <file>`.

**Verified facts (research, do not re-derive):**

- `tests/mock-reset.ts:145` already calls `setBlobStoreForTesting(createInMemoryBlobStoreForTesting())` — the story child runs with an in-memory blob store. The `given.attachment` fixture only calls the real `saveAttachment` (`src/attachments/store.ts:42`, async, drizzle-backed — works in the scenario world).
- `Attachment` (`src/providers/domain-types.ts:6`): `{ id, name, mimeType?, size?, url, ... }` — `url` required; the provider builds `memory://attachments/<id>`.
- Stored `TaskVisibility` uses `users?: UserRef[]`/`groups?: VisibilityGroupRef[]`; tool input uses `userIds`/`groupIds`; the provider maps ids to refs.
- `ProvisionMemberInput = { chatUserId, displayName, username: string | null }` (`src/providers/types.ts:69`).
- The provisioning backstop (`ensureWorkspaceMember`) is fire-and-forget on group turns for non-guest actors — the story polls for its effects (F2a pattern: bounded `setImmediate` yield loop, never wall-clock sleep).
- `saveAttachment` input: `{ contextId, sourceProvider, sourceMessageId, sourceFileId, filename, mimeType?, content: Uint8Array }`; it derives `groupContextId` itself.

---

### Task 1: Integration-surface capability ids (production)

**Files:**

- Modify: `src/tools/core-capabilities.ts`
- Test: `tests/tools/core-capabilities.test.ts`

- [ ] **Step 1: Update the failing test first**

Append to the expected entries in `tests/tools/core-capabilities.test.ts` (after the F2b-1 entries, order matters):

```typescript
      ['tasks.watchers.list', 'list_watchers'],
      ['tasks.watchers.add', 'add_watcher'],
      ['tasks.watchers.remove', 'remove_watcher'],
      ['tasks.votes.add', 'add_vote'],
      ['tasks.votes.remove', 'remove_vote'],
      ['tasks.visibility.set', 'set_visibility'],
      ['tasks.identity.find', 'find_user'],
      ['tasks.identity.current', 'get_current_user'],
      ['tasks.attachments.list', 'list_attachments'],
      ['tasks.attachments.upload', 'upload_attachment'],
      ['tasks.attachments.delete', 'remove_attachment'],
      ['tasks.commands.apply', 'apply_youtrack_command'],
```

- [ ] **Step 2: Run to verify it fails** — `bun test tests/tools/core-capabilities.test.ts` → FAIL.

- [ ] **Step 3: Add the entries** — append the same 12 to `CORE_TOOL_CAPABILITIES` after `'tasks.queries.saved.run'`, in the order above.

- [ ] **Step 4: Run to verify it passes** — `bun test tests/tools/core-capabilities.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/core-capabilities.ts tests/tools/core-capabilities.test.ts
git commit -m "feat(tools): register integration-surface capabilities"
```

---

### Task 2: Provider — collaboration and identity

**Files:**

- Modify: `tests/stories/harness/memory-task-provider.ts`
- Test: `tests/stories/harness/memory-task-provider.test.ts`

Extend `supportedMemoryTaskCapabilities` with `'tasks.watchers'`, `'tasks.votes'`, `'tasks.visibility'`, `'members.provision'`, `'attachments.list'`, `'attachments.upload'`, `'attachments.delete'`, `'tasks.commands'`.

Add state:

```typescript
  private readonly watchers = new Map<string, UserRef[]>()
  private readonly votedTasks = new Set<string>()
  private readonly taskVisibility = new Map<string, TaskVisibility>()
  private readonly attachments = new Map<string, Attachment[]>()
  private currentUser: UserRef | undefined
  private attachmentSequence = 0
  readonly provisionCalls: Array<{ member: ProvisionMemberInput; opts?: { existingProviderUserId?: string; existingLogin?: string; existingPassword?: string } }> = []
  readonly commandCalls: Array<{ query: string; taskIds: string[]; comment?: string; silent?: boolean }> = []
```

(`Task` has no `visibility` field — verified against `src/providers/domain-types.ts:66-86` — so visibility lives in its own map with a public accessor, like `taskSprints`/`taskSprintId` in F2b-1.)

Replace the fixed `readonly traits: ReadonlySet<TaskProviderTrait> = new Set<TaskProviderTrait>()` declaration with BOTH of these, in this order (field initializers run in declaration order — `traitSet` must be declared first):

```typescript
  private readonly traitSet = new Set<TaskProviderTrait>()
  readonly traits: ReadonlySet<TaskProviderTrait> = this.traitSet
```

and add:

```typescript
  setTraits(traits: readonly TaskProviderTrait[]): void {
    for (const trait of traits) this.traitSet.add(trait)
  }
```

- [ ] **Step 1: Write the failing contract tests**

```typescript
describe('collaboration', () => {
  test('manages watchers with duplicate and missing errors', async () => {
    const provider = new MemoryTaskProvider()
    const task = await provider.createTask({ projectId: 'proj-1', title: 'Watched' })

    await expect(provider.addWatcher(task.id, 'alice')).resolves.toEqual({ taskId: task.id, userId: 'alice' })
    await expect(provider.addWatcher(task.id, 'alice')).rejects.toThrow('Task watcher already exists: alice')
    await expect(provider.listWatchers(task.id)).resolves.toEqual([{ id: 'alice' }])
    await expect(provider.removeWatcher(task.id, 'alice')).resolves.toEqual({ taskId: task.id, userId: 'alice' })
    await expect(provider.removeWatcher(task.id, 'alice')).rejects.toThrow('Task watcher not found: alice')
  })

  test('votes are idempotent to add and strict to remove', async () => {
    const provider = new MemoryTaskProvider()
    const task = await provider.createTask({ projectId: 'proj-1', title: 'Voted' })

    await expect(provider.addVote(task.id)).resolves.toEqual({ taskId: task.id })
    await expect(provider.addVote(task.id)).resolves.toEqual({ taskId: task.id })
    await expect(provider.removeVote(task.id)).resolves.toEqual({ taskId: task.id })
    await expect(provider.removeVote(task.id)).rejects.toThrow(`Task vote not found: ${task.id}`)
  })

  test('stores visibility with user refs', async () => {
    const provider = new MemoryTaskProvider()
    const task = await provider.createTask({ projectId: 'proj-1', title: 'Hidden' })

    await expect(provider.setVisibility(task.id, { kind: 'restricted', userIds: ['alice'] })).resolves.toEqual({
      taskId: task.id,
      visibility: { kind: 'restricted', users: [{ id: 'alice' }] },
    })
    expect(provider.getTaskVisibility(task.id)).toEqual({ kind: 'restricted', users: [{ id: 'alice' }] })
    await expect(provider.setVisibility(task.id, { kind: 'public' })).resolves.toEqual({
      taskId: task.id,
      visibility: { kind: 'public' },
    })
  })
})

describe('identity surface', () => {
  test('finds users, returns the seeded current user, and records provisions', async () => {
    const provider = new MemoryTaskProvider()
    provider.addIdentityUser({ id: 'ku-alice', username: 'alice', displayName: 'Alice A' })
    provider.addIdentityUser({ id: 'ku-bob', username: 'bobby', displayName: 'Bob B' })
    provider.setCurrentUser({ id: 'ku-alice', login: 'alice' })

    await expect(provider.listUsers('ali')).resolves.toEqual([{ id: 'ku-alice', login: 'alice', name: 'Alice A' }])
    await expect(provider.getCurrentUser()).resolves.toEqual({ id: 'ku-alice', login: 'alice' })

    const provisioned = await provider.provisionWorkspaceMember({
      chatUserId: 'alice',
      displayName: 'Alice A',
      username: 'alice',
    })
    expect(provisioned).toEqual({ providerUserId: 'prov-alice', login: 'alice', password: 'memory-password' })
    expect(provider.provisionCalls).toHaveLength(1)
    expect(provider.provisionCalls.at(0)?.member).toEqual({
      chatUserId: 'alice',
      displayName: 'Alice A',
      username: 'alice',
    })
  })
})

describe('traits', () => {
  test('setTraits mutates the captured set in place', () => {
    const provider = new MemoryTaskProvider()
    const captured = provider.traits

    provider.setTraits(['command-language:youtrack', 'supports-command-language'])

    expect(captured.has('command-language:youtrack')).toBe(true)
    expect(captured.has('supports-command-language')).toBe(true)
  })
})
```

(Adjust `addIdentityUser` input/`listUsers` output shape to the real `IdentityUser`/`UserRef` fields if they differ — `UserRef` is `{ id, login?, name? }`; map `username → login`, `displayName → name`. Report the actual mapping used.)

- [ ] **Step 2: Run to verify they fail** — `bun test --path-ignore-patterns '' tests/stories/harness/memory-task-provider.test.ts` → FAIL.

- [ ] **Step 3: Implement**

```typescript
  listWatchers(taskId: string): Promise<UserRef[]> {
    return Promise.resolve().then(() => {
      this.requireTask(taskId)
      const result = this.watchers.get(taskId) ?? []
      this.events?.record('task.watchers.list', { taskId, count: result.length })
      return clone(result)
    })
  }

  addWatcher(taskId: string, userId: string): Promise<{ taskId: string; userId: string }> {
    return Promise.resolve().then(() => {
      this.requireTask(taskId)
      const watchers = this.watchers.get(taskId) ?? []
      if (watchers.some((watcher) => watcher.id === userId)) throw new Error(`Task watcher already exists: ${userId}`)
      this.watchers.set(taskId, [...watchers, { id: userId }])
      this.events?.record('task.watchers.add', { taskId, userId })
      return { taskId, userId }
    })
  }

  removeWatcher(taskId: string, userId: string): Promise<{ taskId: string; userId: string }> {
    return Promise.resolve().then(() => {
      this.requireTask(taskId)
      const watchers = this.watchers.get(taskId) ?? []
      if (!watchers.some((watcher) => watcher.id === userId)) throw new Error(`Task watcher not found: ${userId}`)
      this.watchers.set(taskId, watchers.filter((watcher) => watcher.id !== userId))
      this.events?.record('task.watchers.remove', { taskId, userId })
      return { taskId, userId }
    })
  }

  addVote(taskId: string): Promise<{ taskId: string }> {
    return Promise.resolve().then(() => {
      this.requireTask(taskId)
      this.votedTasks.add(taskId)
      this.events?.record('task.vote.add', { taskId })
      return { taskId }
    })
  }

  removeVote(taskId: string): Promise<{ taskId: string }> {
    return Promise.resolve().then(() => {
      this.requireTask(taskId)
      if (!this.votedTasks.delete(taskId)) throw new Error(`Task vote not found: ${taskId}`)
      this.events?.record('task.vote.remove', { taskId })
      return { taskId }
    })
  }

  setVisibility(taskId: string, params: SetTaskVisibilityParams): Promise<{ taskId: string; visibility: TaskVisibility }> {
    const input = clone(params)
    return Promise.resolve().then(() => {
      this.requireTask(taskId)
      const visibility: TaskVisibility =
        input.kind === 'public'
          ? { kind: 'public' }
          : {
              kind: 'restricted',
              ...(input.userIds === undefined ? {} : { users: input.userIds.map((id) => ({ id })) }),
              ...(input.groupIds === undefined ? {} : { groups: input.groupIds.map((name) => ({ name })) }),
            }
      this.taskVisibility.set(taskId, clone(visibility))
      this.events?.record('task.visibility.set', { taskId, kind: visibility.kind })
      return { taskId, visibility }
    })
  }

  getTaskVisibility(taskId: string): TaskVisibility {
    this.requireTask(taskId)
    return clone(this.taskVisibility.get(taskId) ?? { kind: 'public' })
  }

  listUsers(query?: string, limit = 10): Promise<UserRef[]> {
    const normalized = (query ?? '').toLowerCase()
    const matches = [...this.identityUsers.values()]
      .filter((identity) => identityMatches(identity, normalized))
      .slice(0, limit)
      .map((identity) => ({ id: identity.id, login: identity.username, name: identity.displayName }))
    return Promise.resolve(clone(matches))
  }

  getCurrentUser(): Promise<UserRef> {
    return Promise.resolve().then(() => {
      if (this.currentUser === undefined) throw new Error('MemoryTaskProvider has no current user')
      return clone(this.currentUser)
    })
  }

  setCurrentUser(user: UserRef): void {
    this.currentUser = clone(user)
  }

  provisionWorkspaceMember(
    member: ProvisionMemberInput,
    opts?: Readonly<{ existingProviderUserId?: string; existingLogin?: string; existingPassword?: string }>,
  ): Promise<{ providerUserId: string; login: string; password: string }> {
    this.provisionCalls.push({ member: clone(member), ...(opts === undefined ? {} : { opts: clone(opts) }) })
    this.events?.record('member.provision', { login: member.username ?? member.chatUserId })
    const login = member.username ?? member.chatUserId
    return Promise.resolve({ providerUserId: `prov-${login}`, login, password: 'memory-password' })
  }
```

(Add `SetTaskVisibilityParams`, `TaskVisibility`, `ProvisionMemberInput` to the type imports. `identityMatches` and `identityUsers` already exist in the file — reuse the same matcher the identityResolver uses.)

- [ ] **Step 4: Run to verify they pass** — `bun test --path-ignore-patterns '' tests/stories/harness/memory-task-provider.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/stories/harness/memory-task-provider.ts tests/stories/harness/memory-task-provider.test.ts
git commit -m "test(stories): add collaboration and identity surface to the memory provider"
```

---

### Task 3: Provider — attachments and `applyCommand`

**Files:**

- Modify: `tests/stories/harness/memory-task-provider.ts`
- Test: `tests/stories/harness/memory-task-provider.test.ts`

- [ ] **Step 1: Write the failing contract tests**

```typescript
describe('attachments', () => {
  test('uploads, lists, and deletes attachment metadata', async () => {
    const provider = new MemoryTaskProvider()
    const task = await provider.createTask({ projectId: 'proj-1', title: 'Documented' })
    const content = new TextEncoder().encode('hello')

    const uploaded = await provider.uploadAttachment(task.id, { name: 'spec.txt', content, mimeType: 'text/plain' })
    expect(uploaded).toMatchObject({
      id: 'attachment-1',
      name: 'spec.txt',
      size: 5,
      url: 'memory://attachments/attachment-1',
    })
    await expect(provider.listAttachments(task.id)).resolves.toHaveLength(1)
    await expect(provider.deleteAttachment(task.id, 'attachment-1')).resolves.toEqual({ id: 'attachment-1' })
    await expect(provider.deleteAttachment(task.id, 'attachment-1')).rejects.toThrow(
      'Attachment not found: attachment-1',
    )
  })
})

describe('applyCommand', () => {
  test('records and echoes the command payload', async () => {
    const provider = new MemoryTaskProvider()

    await expect(
      provider.applyCommand({ query: 'state Fixed', taskIds: ['task-1'], comment: 'done', silent: true }),
    ).resolves.toEqual({ query: 'state Fixed', taskIds: ['task-1'], comment: 'done', silent: true })
    expect(provider.commandCalls).toEqual([
      { query: 'state Fixed', taskIds: ['task-1'], comment: 'done', silent: true },
    ])
  })
})
```

- [ ] **Step 2: Run to verify they fail** — same command → FAIL.

- [ ] **Step 3: Implement**

```typescript
  listAttachments(taskId: string): Promise<Attachment[]> {
    return Promise.resolve().then(() => {
      this.requireTask(taskId)
      const result = this.attachments.get(taskId) ?? []
      this.events?.record('attachment.list', { taskId, count: result.length })
      return clone(result)
    })
  }

  uploadAttachment(
    taskId: string,
    file: Readonly<{ name: string; content: Uint8Array | Blob; mimeType?: string }>,
  ): Promise<Attachment> {
    return Promise.resolve().then(() => {
      this.requireTask(taskId)
      const id = `attachment-${++this.attachmentSequence}`
      const size = typeof file.content === 'object' && 'size' in file.content ? file.content.size : file.content.length
      const attachment: Attachment = {
        id,
        name: file.name,
        url: `memory://attachments/${id}`,
        size,
        ...(file.mimeType === undefined ? {} : { mimeType: file.mimeType }),
      }
      this.attachments.set(taskId, [...(this.attachments.get(taskId) ?? []), clone(attachment)])
      this.events?.record('attachment.upload', { taskId, attachmentId: id })
      return clone(attachment)
    })
  }

  deleteAttachment(taskId: string, attachmentId: string): Promise<{ id: string }> {
    return Promise.resolve().then(() => {
      this.requireTask(taskId)
      const attachments = this.attachments.get(taskId) ?? []
      if (!attachments.some((attachment) => attachment.id === attachmentId)) {
        throw new Error(`Attachment not found: ${attachmentId}`)
      }
      this.attachments.set(taskId, attachments.filter((attachment) => attachment.id !== attachmentId))
      this.events?.record('attachment.delete', { taskId, attachmentId })
      return { id: attachmentId }
    })
  }

  applyCommand(
    params: Readonly<{ query: string; taskIds: string[]; comment?: string; silent?: boolean }>,
  ): Promise<TaskCommandResult> {
    const input = clone(params)
    this.commandCalls.push(clone(input))
    this.events?.record('command.apply', { taskIds: input.taskIds })
    return Promise.resolve(clone(input))
  }
```

(Add `Attachment`, `TaskCommandResult` to the type imports. The `size` computation handles both `Uint8Array` (`.length`) and `Blob` (`.size`); if the lint or types complain about the narrowing, compute it via a small typed helper.)

- [ ] **Step 4: Run to verify they pass** — same command → PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/stories/harness/memory-task-provider.ts tests/stories/harness/memory-task-provider.test.ts
git commit -m "test(stories): add attachments and applyCommand to the memory provider"
```

---

### Task 4: `given.attachment` relay fixture

**Files:**

- Modify: `tests/stories/harness/fixtures.ts`, `tests/stories/harness/scenario.ts`
- Test: `tests/stories/harness/fixtures.test.ts`

- [ ] **Step 1: Write the failing contract test**

```typescript
test('given.attachment seeds the relay and upload_attachment consumes it', async () => {
  await executeScenario('attachment relay fixture', async ({ given, when, then }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    const instance = given.taskInstance()
    given.assign(dm, instance)
    given.taskCapabilities(['attachments.list', 'attachments.upload'])
    const file = await given.attachment(dm, { filename: 'spec.txt', content: 'hello relay' })
    given.llm([
      callCapability('tasks.create', { projectId: 'proj-1', title: 'Documented' }),
      callCapability('tasks.attachments.upload', { taskId: 'task-1', attachmentId: file.id }),
      answer('Uploaded “spec.txt”.'),
    ])

    await when.message(alice, dm, 'Attach spec.txt to a new task')

    then.replyTo(alice).equals('Uploaded “spec.txt”.')
  })
})
```

- [ ] **Step 2: Run to verify it fails** — `bun test --path-ignore-patterns '' tests/stories/harness/fixtures.test.ts` → FAIL (`given.attachment` is not a function).

- [ ] **Step 3: Implement**

In `tests/stories/harness/fixtures.ts`, add to the fixtures surface:

```typescript
  seedRelayAttachment(input: Readonly<{ contextId: string; filename: string; content: string; mimeType?: string }>): Promise<{ id: string }>
```

implemented by calling the real `saveAttachment` (`src/attachments/store.js`):

```typescript
    async seedRelayAttachment(input) {
      const ref = await saveAttachment({
        contextId: input.contextId,
        sourceProvider: 'scenario',
        sourceMessageId: `relay-${input.filename}`,
        sourceFileId: `file-${input.filename}`,
        filename: input.filename,
        ...(input.mimeType === undefined ? {} : { mimeType: input.mimeType }),
        content: new TextEncoder().encode(input.content),
      })
      return { id: ref.attachmentId }
    },
```

(`saveAttachment` returns the created ref — use its actual attachment-id field name; check `AttachmentRef` and report if it differs. The blob store is already in-memory via the test preload — do NOT reinstall it.)

In `tests/stories/harness/scenario.ts`, add to `ScenarioGiven` (type + impl):

```typescript
    attachment(context: ContextHandle, file: Readonly<{ filename: string; content: string; mimeType?: string }>): Promise<AttachmentHandle> {
      prerequisite('given.attachment')
      return world.fixtures.seedRelayAttachment({ contextId: contextId(context), ...file })
    },
```

(`contextId(context)` is the existing helper used by `replyIn` — it produces the storage context id `upload_attachment` resolves for that context. `AttachmentHandle = Readonly<{ id: string }>` — define it next to the other handle types.)

- [ ] **Step 4: Run to verify it passes** — `bun test --path-ignore-patterns '' tests/stories/harness/fixtures.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/stories/harness/fixtures.ts tests/stories/harness/scenario.ts tests/stories/harness/fixtures.test.ts
git commit -m "test(stories): add attachment relay fixture"
```

---

### Task 5: Integration-surface story file (4 scenarios)

**Files:**

- Create: `tests/stories/tasks/integration-surface.story.test.ts`

Header/imports mirror the other task story files. `given.assign` + minimal `given.taskCapabilities([...])` per scenario. Scenario names must match Task 6's mapping byte-for-byte.

- [ ] **Step 1: collaboration and identity (2 scenarios)**

```typescript
scenario('SCN-task-collaboration: manages watchers, votes, and visibility', async ({ given, when, then, world }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  const instance = given.taskInstance()
  given.assign(dm, instance)
  given.taskCapabilities(['tasks.watchers', 'tasks.votes', 'tasks.visibility'])
  given.llm([callCapability('tasks.create', { projectId: 'proj-1', title: 'Watched' }), answer('Created.')])

  await when.message(alice, dm, 'Create task Watched')

  given.llm([
    callCapability('tasks.watchers.add', { taskId: 'task-1', userId: 'alice' }),
    callCapability('tasks.watchers.list', { taskId: 'task-1' }),
    answer('alice is watching.'),
  ])
  await when.message(alice, dm, 'Watch it for me')
  then.replyTo(alice).equals('alice is watching.')
  expect(await world.tasks.listWatchers('task-1')).toEqual([{ id: 'alice' }])

  given.llm([
    callCapability('tasks.votes.add', { taskId: 'task-1' }),
    callCapability('tasks.votes.remove', { taskId: 'task-1' }),
    answer('Voted, then unvoted.'),
  ])
  await when.message(alice, dm, 'Vote for it, then take the vote back')
  then.replyTo(alice).equals('Voted, then unvoted.')

  given.llm([
    callCapability('tasks.visibility.set', { taskId: 'task-1', visibility: 'restricted', userIds: ['alice'] }),
    answer('Now restricted to you.'),
  ])
  await when.message(alice, dm, 'Restrict it to me')
  expect(world.tasks.getTaskVisibility('task-1')).toEqual({ kind: 'restricted', users: [{ id: 'alice' }] })

  given.llm([
    callCapability('tasks.watchers.remove', { taskId: 'task-1', userId: 'alice' }),
    callCapability('tasks.visibility.set', { taskId: 'task-1', visibility: 'public' }),
    answer('Unwatched and public again.'),
  ])
  await when.message(alice, dm, 'Unwatch and make it public')
  expect(await world.tasks.listWatchers('task-1')).toEqual([])
  expect(world.tasks.getTaskVisibility('task-1')).toEqual({ kind: 'public' })
})
```

```typescript
scenario(
  'SCN-task-identity: finds users and provisions members on group turns',
  async ({ given, when, then, world }) => {
    const alice = given.user('alice')
    const team = given.group('team')
    given.member(team, alice)
    const instance = given.taskInstance()
    given.assign(team, instance)
    given.taskCapabilities(['members.provision'])
    given.providerUser({ id: 'ku-alice', username: 'alice', displayName: 'Alice A' })
    world.tasks.setCurrentUser({ id: 'ku-alice', login: 'alice' })
    given.llm([
      callCapability('tasks.identity.find', { query: 'ali' }),
      callCapability('tasks.identity.current', {}),
      answer('Found Alice; you are alice.'),
    ])

    await when.message(alice, team, 'Who am I on the tracker?')

    then.replyIn(team).contains('alice')
    const provisioned = await waitFor(() => world.tasks.provisionCalls.length >= 1)
    expect(provisioned).toBe(true)
    expect(world.tasks.provisionCalls.at(0)?.member.chatUserId).toBe('alice')
    expect(await readWorkspaceMember('alice')).toMatchObject({ providerUserId: 'prov-alice' })
  },
)
```

For the identity scenario, add two top-level helpers to the story file (conditionals are lint-safe at top level):

```typescript
const waitFor = async (condition: () => boolean): Promise<boolean> => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (condition()) return true
    await new Promise((resolve) => setImmediate(resolve))
  }
  return false
}
```

and `readWorkspaceMember(chatUserId)` — read the `kaneoWorkspaceMembers` row the backstop upserts, via the production drizzle schema (`getDrizzleDb` + the schema table from `src/db/schema/...` — locate the exact table/export at implementation; the group turn must be a GROUP context so the backstop fires, and `given.assign(team, instance)` keys the provider to the group). If a production read helper for workspace members exists, use it instead and note it.

- [ ] **Step 2: attachments and youtrack-command (2 scenarios)**

```typescript
scenario(
  'SCN-task-attachments: uploads from the relay and removes attachments',
  async ({ given, when, then, world }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    const instance = given.taskInstance()
    given.assign(dm, instance)
    given.taskCapabilities(['attachments.list', 'attachments.upload', 'attachments.delete'])
    const file = await given.attachment(dm, { filename: 'spec.txt', content: 'relay payload' })
    given.llm([callCapability('tasks.create', { projectId: 'proj-1', title: 'Documented' }), answer('Created.')])

    await when.message(alice, dm, 'Create task Documented')

    given.llm([
      callCapability('tasks.attachments.upload', { taskId: 'task-1', attachmentId: file.id }),
      callCapability('tasks.attachments.list', { taskId: 'task-1' }),
      answer('Attached “spec.txt”.'),
    ])
    await when.message(alice, dm, 'Attach the file to it')
    then.replyTo(alice).equals('Attached “spec.txt”.')
    expect(await world.tasks.listAttachments('task-1')).toHaveLength(1)

    given.llm([
      callCapability('tasks.attachments.upload', { taskId: 'task-1', attachmentId: 'att_missing' }),
      answer('That file is no longer available.'),
    ])
    await when.message(alice, dm, 'Attach it again from the old link')
    then.replyTo(alice).equals('That file is no longer available.')
    expect(await world.tasks.listAttachments('task-1')).toHaveLength(1)

    given.llm([
      callCapability('tasks.attachments.delete', { taskId: 'task-1', attachmentId: 'attachment-1', confidence: 0.9 }),
      answer('Attachment removed.'),
    ])
    await when.message(alice, dm, 'Remove the attachment')
    expect(await world.tasks.listAttachments('task-1')).toHaveLength(0)
  },
)

scenario(
  'SCN-task-youtrack-command: applies a YouTrack command to one task only',
  async ({ given, when, then, world }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    const instance = given.taskInstance()
    given.assign(dm, instance)
    given.taskCapabilities(['tasks.commands'])
    world.tasks.setTraits(['command-language:youtrack', 'supports-command-language'])
    given.llm([callCapability('tasks.create', { projectId: 'proj-1', title: 'Commanded' }), answer('Created.')])

    await when.message(alice, dm, 'Create task Commanded')

    given.llm([
      callCapability('tasks.commands.apply', { query: 'state Fixed', taskIds: ['task-1'], confidence: 0.9 }),
      answer('Marked it Fixed.'),
    ])
    await when.message(alice, dm, 'Mark it Fixed with a command')
    then.replyTo(alice).equals('Marked it Fixed.')
    expect(world.tasks.commandCalls).toEqual([{ query: 'state Fixed', taskIds: ['task-1'], confidence: 0.9 }])

    given.llm([
      callCapability('tasks.commands.apply', { query: 'state Fixed', taskIds: ['task-1', 'task-2'], confidence: 0.9 }),
      answer('I can only run commands on one task at a time.'),
    ])
    await when.message(alice, dm, 'Mark both tasks Fixed')
    then.replyTo(alice).equals('I can only run commands on one task at a time.')
    expect(world.tasks.commandCalls).toHaveLength(1)
  },
)
```

(The `apply_youtrack_command` tool rejects `taskIds.length > 1` before calling the provider — the second scripted call surfaces that tool-level rejection as the tool result, and `commandCalls` staying at 1 proves the provider was never invoked. Note: the tool forwards `confidence` only into its own gate, not to `applyCommand` — the `commandCalls` assertion may need to drop `confidence` from the expected payload; verify the real `TaskCommandResult` echo at runtime and adjust, reporting the actual shape.)

- [ ] **Step 3: Run the story file** — `bun test:stories` → 77 pass / 0 fail (73 + 4).

- [ ] **Step 4: Commit**

```bash
git add tests/stories/tasks/integration-surface.story.test.ts
git commit -m "test(stories): cover the task integration surface"
```

---

### Task 6: Ledger update

**Files:**

- Modify: `tests/stories/catalog/coverage.ts`
- Test: `tests/stories/harness/catalog-coverage.test.ts`, `tests/scripts/story-coverage-totals.test.ts`

- [ ] **Step 1: Update the failing contract tests first**

`tracks the executable coverage total` 65 → `69`; `audit records cover exactly the pending scenarios` 63 → `59`; `audit readiness totals` → `2`, `35`, `22`. Totals test: `{ total: 128, executable: 69, pending: 59, readiness: { 'executable-as-is': 2, 'needs-seam': 35, blocked: 22 } }` and format string `'story catalog: 69/128 executable; pending 59 (2 executable-as-is, 35 needs-seam, 22 blocked)'`.

- [ ] **Step 2: Run to verify they fail** — `bun test --path-ignore-patterns '' tests/stories/harness/catalog-coverage.test.ts && bun test tests/scripts/story-coverage-totals.test.ts` → FAIL.

- [ ] **Step 3: Move the 4 entries**

Delete from `AUDIT_RECORDS`: `SCN-task-collaboration`, `SCN-task-identity`, `SCN-task-attachments`, `SCN-task-youtrack-command`. Add to `EXECUTABLE_STORY_MAPPINGS` with `verifiedAt: '2026-07-19'` — copy scenario names from the story file byte-for-byte:

```typescript
  'SCN-task-collaboration': {
    verifiedAt: '2026-07-19',
    storyIds: ['tests/stories/tasks/integration-surface.story.test.ts#SCN-task-collaboration: manages watchers, votes, and visibility'],
  },
  'SCN-task-identity': {
    verifiedAt: '2026-07-19',
    storyIds: ['tests/stories/tasks/integration-surface.story.test.ts#SCN-task-identity: finds users and provisions members on group turns'],
  },
  'SCN-task-attachments': {
    verifiedAt: '2026-07-19',
    storyIds: ['tests/stories/tasks/integration-surface.story.test.ts#SCN-task-attachments: uploads from the relay and removes attachments'],
  },
  'SCN-task-youtrack-command': {
    verifiedAt: '2026-07-19',
    storyIds: ['tests/stories/tasks/integration-surface.story.test.ts#SCN-task-youtrack-command: applies a YouTrack command to one task only'],
  },
```

- [ ] **Step 4: Run the ledger tests to verify they pass** — same command → PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/stories/catalog/coverage.ts tests/stories/harness/catalog-coverage.test.ts tests/scripts/story-coverage-totals.test.ts
git commit -m "test(stories): map F2b-2 integration-surface scenarios in the catalog"
```

---

### Task 7: Final verification gate

- [ ] **Step 1: Sandboxed story suite** — `bun test:stories` → 77 pass / 0 fail; `task-*` is 21/21.
- [ ] **Step 2: Sandboxed contract suites** — `bun test:stories:contracts` → all pass.
- [ ] **Step 3: Runner and touched unit suites** — `bun test tests/scripts/ tests/tools/core-capabilities.test.ts` → all pass.
- [ ] **Step 4: Typecheck and lint** — `bun run typecheck && bun run lint` → clean.
- [ ] **Step 5: Fresh manifest, totals line, compat** — `bun test:stories:manifest 2>&1 | grep "story catalog"` → `story catalog: 69/128 executable; pending 59 (2 executable-as-is, 35 needs-seam, 22 blocked)`; manifest scenario count is 78 (74 + 4). Then `git status --short` (clean) and `bun scripts/story/test-stories.ts --compat --baseline-ref HEAD --manifest-only` → exit 0.
