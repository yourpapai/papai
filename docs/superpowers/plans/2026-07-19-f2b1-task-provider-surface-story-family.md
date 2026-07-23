<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# F2b-1 Task Provider-Surface Story Family Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the 7 pure provider-surface `task-*` scenarios real, moving the catalog ledger from 58 to 65 executable stories.

**Architecture:** 27 production capability-id entries, then six MemoryTaskProvider state groups (projects, statuses, project team, relations, worklog, sprints/saved-queries) with honest semantics, then one 7-scenario story file, then the ledger update.

**Tech Stack:** Bun, TypeScript (strict), bun:test.

**Spec:** `docs/superpowers/specs/2026-07-19-f2b1-task-provider-surface-story-family-design.md`

**Ledger after this plan:** 128 ids, 65 executable, 63 pending (2 `executable-as-is`, 39 `needs-seam`, 22 `blocked`). Story suite: 66 → 73.

**Frozen-tree note:** this plan changes frozen inputs (harness, catalog). Re-record the compat baseline after landing. Stories run sandboxed (`bun test:stories`, Docker required); contract files run via `bun test --path-ignore-patterns '' <file>`.

**Execution learnings (apply throughout):** stories need `given.assign(dm, instance)` AND `given.taskCapabilities([...])` for gated tools (the world seeds zero capabilities); `create_task` requires `projectId`; policy assertions use `world.runtime.resolveToolCapability`, never `availableTools` non-contains; the first capability call in a turn routes through an automatic `load_tool` hop; conditionals live at story-file top level, not in scenario bodies.

**Domain shape facts (verified against `src/providers/domain-types.ts`):** `Column` uses `order?: number` (NOT `position` — only the `reorderStatuses` params use `position`); `Project` requires `url` (use `this.buildProjectUrl(id)`); `WorkItem` requires `author` + `date` + `duration` — the memory provider defaults `author: 'unknown'` and `date: '2026-01-01'` when omitted (deterministic); `Sprint.archived` is required (default `false`); `RelationType` has 7 values but the tool schema accepts only `blocks`/`duplicate`/`related`/`parent`; `SavedQuery.query` is optional — `runSavedQuery` with no query returns all tasks.

---

### Task 1: Provider-surface capability ids (production)

**Files:**

- Modify: `src/tools/core-capabilities.ts`
- Test: `tests/tools/core-capabilities.test.ts`

- [ ] **Step 1: Update the failing test first**

In `tests/tools/core-capabilities.test.ts`, extend the expected entries in `registers the stable core capabilities when their real wire tools are offered` — append these after the F2a entries (order matters):

```typescript
      ['tasks.relations.add', 'add_task_relation'],
      ['tasks.relations.update', 'update_task_relation'],
      ['tasks.relations.remove', 'remove_task_relation'],
      ['tasks.statuses.list', 'list_statuses'],
      ['tasks.statuses.create', 'create_status'],
      ['tasks.statuses.update', 'update_status'],
      ['tasks.statuses.delete', 'delete_status'],
      ['tasks.statuses.reorder', 'reorder_statuses'],
      ['tasks.projects.get', 'get_project'],
      ['tasks.projects.list', 'list_projects'],
      ['tasks.projects.create', 'create_project'],
      ['tasks.projects.update', 'update_project'],
      ['tasks.projects.delete', 'delete_project'],
      ['tasks.projects.team.list', 'list_project_team'],
      ['tasks.projects.team.add', 'add_project_member'],
      ['tasks.projects.team.remove', 'remove_project_member'],
      ['tasks.worklog.list', 'list_work'],
      ['tasks.worklog.create', 'log_work'],
      ['tasks.worklog.update', 'update_work'],
      ['tasks.worklog.delete', 'remove_work'],
      ['tasks.agiles.list', 'list_agiles'],
      ['tasks.sprints.list', 'list_sprints'],
      ['tasks.sprints.create', 'create_sprint'],
      ['tasks.sprints.update', 'update_sprint'],
      ['tasks.sprints.assign', 'assign_task_to_sprint'],
      ['tasks.queries.saved.list', 'list_saved_queries'],
      ['tasks.queries.saved.run', 'run_saved_query'],
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test tests/tools/core-capabilities.test.ts`
Expected: FAIL — actual entries lack the 27 new mappings.

- [ ] **Step 3: Add the entries**

In `src/tools/core-capabilities.ts`, append the same 27 entries to `CORE_TOOL_CAPABILITIES` after `'tasks.labels.unassign'`, in the order above.

- [ ] **Step 4: Run to verify it passes**

Run: `bun test tests/tools/core-capabilities.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/core-capabilities.ts tests/tools/core-capabilities.test.ts
git commit -m "feat(tools): register provider-surface capabilities"
```

---

### Task 2: Provider — projects, statuses, project team

**Files:**

- Modify: `tests/stories/harness/memory-task-provider.ts`
- Test: `tests/stories/harness/memory-task-provider.test.ts`

Add to the type imports from `../../../src/providers/types.js`: `Agile`, `Column`, `Project`, `RelationType`, `SavedQuery`, `Sprint`, `UserRef`, `WorkItem` (all re-exported there) plus `CreateWorkItemParams`/`UpdateWorkItemParams` as needed.

Extend `supportedMemoryTaskCapabilities` with:

```typescript
  'tasks.relations',
  'statuses.list',
  'statuses.create',
  'statuses.update',
  'statuses.delete',
  'statuses.reorder',
  'projects.read',
  'projects.list',
  'projects.create',
  'projects.update',
  'projects.delete',
  'projects.team',
  'workItems.list',
  'workItems.create',
  'workItems.update',
  'workItems.delete',
  'agiles.list',
  'sprints.list',
  'sprints.create',
  'sprints.update',
  'sprints.assign',
  'queries.saved',
```

Add state and sequences:

```typescript
  private readonly projects = new Map<string, Project>()
  private readonly statuses = new Map<string, Column[]>()
  private readonly projectTeam = new Map<string, UserRef[]>()
  private readonly relations = new Map<string, Map<string, RelationType>>()
  private readonly workItems = new Map<string, WorkItem[]>()
  private readonly agiles = new Map<string, Agile>()
  private readonly sprints = new Map<string, Sprint[]>()
  private readonly taskSprints = new Map<string, string>()
  private readonly savedQueries = new Map<string, SavedQuery>()
  private projectSequence = 0
  private statusSequence = 0
  private workSequence = 0
  private agileSequence = 0
  private sprintSequence = 0
  private querySequence = 0
```

Implement this task's three groups following the file's conventions (clone in/out, `Promise.resolve().then`, `events?.record`, exact errors). Add private `requireProject`/`requireColumn` helpers mirroring `requireTask`:

```typescript
  private requireProject(projectId: string): Project {
    const project = this.projects.get(projectId)
    if (project === undefined) throw new Error(`Project not found: ${projectId}`)
    return project
  }

  private requireColumn(projectId: string, statusId: string): Column {
    const column = (this.statuses.get(projectId) ?? []).find((entry) => entry.id === statusId)
    if (column === undefined) throw new Error(`Status not found: project ${projectId}, status ${statusId}`)
    return column
  }
```

**Projects:**

```typescript
  listProjects(): Promise<Project[]> {
    return Promise.resolve().then(() => {
      const result = [...this.projects.values()]
      this.events?.record('project.list', { count: result.length })
      return clone(result)
    })
  }

  getProject(projectId: string): Promise<Project> {
    return Promise.resolve().then(() => {
      const project = this.requireProject(projectId)
      this.events?.record('project.get', { projectId })
      return clone(project)
    })
  }

  createProject(params: Readonly<{ name: string; description?: string }>): Promise<Project> {
    const input = clone(params)
    return Promise.resolve().then(() => {
      if ([...this.projects.values()].some((project) => project.name === input.name)) {
        throw new Error(`Project already exists: ${input.name}`)
      }
      const id = `project-${++this.projectSequence}`
      const project: Project = { id, name: input.name, url: this.buildProjectUrl(id), ...(input.description === undefined ? {} : { description: input.description }) }
      this.projects.set(id, clone(project))
      this.events?.record('project.create', { projectId: id })
      return clone(project)
    })
  }

  updateProject(projectId: string, params: Readonly<{ name?: string; description?: string }>): Promise<Project> {
    const input = clone(params)
    return Promise.resolve().then(() => {
      const existing = this.requireProject(projectId)
      if (input.name !== undefined && input.name !== existing.name && [...this.projects.values()].some((project) => project.name === input.name)) {
        throw new Error(`Project already exists: ${input.name}`)
      }
      const updated: Project = {
        ...existing,
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.description === undefined ? {} : { description: input.description }),
      }
      this.projects.set(projectId, clone(updated))
      this.events?.record('project.update', { projectId, fields: Object.keys(input).sort() })
      return clone(updated)
    })
  }

  deleteProject(projectId: string): Promise<{ id: string }> {
    return Promise.resolve().then(() => {
      this.requireProject(projectId)
      this.projects.delete(projectId)
      this.statuses.delete(projectId)
      this.projectTeam.delete(projectId)
      this.events?.record('project.delete', { projectId })
      return { id: projectId }
    })
  }
```

**Statuses** (confirmation passthrough: mutating ops return `confirmation_required` unless `confirm === true`; type the union returns like the interface):

```typescript
  listStatuses(projectId: string): Promise<Column[]> {
    return Promise.resolve().then(() => {
      this.requireProject(projectId)
      const result = [...(this.statuses.get(projectId) ?? [])].sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
      this.events?.record('status.list', { projectId, count: result.length })
      return clone(result)
    })
  }

  createStatus(
    projectId: string,
    params: Readonly<{ name: string; icon?: string; color?: string; isFinal?: boolean }>,
    confirm?: boolean,
  ): Promise<Column | { status: 'confirmation_required'; message: string }> {
    const input = clone(params)
    return Promise.resolve().then(() => {
      this.requireProject(projectId)
      if (confirm !== true) {
        return { status: 'confirmation_required' as const, message: `Creating status "${input.name}" changes the shared status set — confirm to proceed.` }
      }
      const columns = this.statuses.get(projectId) ?? []
      const column: Column = {
        id: `status-${++this.statusSequence}`,
        name: input.name,
        order: columns.length,
        ...(input.isFinal === undefined ? {} : { isFinal: input.isFinal }),
      }
      this.statuses.set(projectId, [...columns, clone(column)])
      this.events?.record('status.create', { projectId, statusId: column.id })
      return clone(column)
    })
  }

  updateStatus(
    projectId: string,
    statusId: string,
    params: Readonly<{ name?: string; icon?: string; color?: string; isFinal?: boolean }>,
    confirm?: boolean,
  ): Promise<Column | { status: 'confirmation_required'; message: string }> {
    const input = clone(params)
    return Promise.resolve().then(() => {
      const existing = this.requireColumn(projectId, statusId)
      if (confirm !== true) {
        return { status: 'confirmation_required' as const, message: `Updating status "${existing.name}" changes the shared status set — confirm to proceed.` }
      }
      const updated: Column = { ...existing, ...definedStatusUpdate(input), id: statusId }
      this.statuses.set(projectId, (this.statuses.get(projectId) ?? []).map((entry) => (entry.id === statusId ? clone(updated) : entry)))
      this.events?.record('status.update', { projectId, statusId })
      return clone(updated)
    })
  }

  deleteStatus(
    projectId: string,
    statusId: string,
    confirm?: boolean,
  ): Promise<{ id: string } | { status: 'confirmation_required'; message: string }> {
    return Promise.resolve().then(() => {
      const existing = this.requireColumn(projectId, statusId)
      if (confirm !== true) {
        return { status: 'confirmation_required' as const, message: `Deleting status "${existing.name}" changes the shared status set — confirm to proceed.` }
      }
      this.statuses.set(projectId, (this.statuses.get(projectId) ?? []).filter((entry) => entry.id !== statusId))
      this.events?.record('status.delete', { projectId, statusId })
      return { id: statusId }
    })
  }

  reorderStatuses(
    projectId: string,
    statuses: ReadonlyArray<Readonly<{ id: string; position: number }>>,
    confirm?: boolean,
  ): Promise<undefined | { status: 'confirmation_required'; message: string }> {
    const input = clone(statuses)
    return Promise.resolve().then(() => {
      this.requireProject(projectId)
      if (confirm !== true) {
        return { status: 'confirmation_required' as const, message: 'Reordering statuses changes the shared status set — confirm to proceed.' }
      }
      const positions = new Map(input.map((entry) => [entry.id, entry.position]))
      const reordered = (this.statuses.get(projectId) ?? []).map((entry) => {
        const position = positions.get(entry.id)
        return position === undefined ? entry : { ...entry, order: position }
      })
      this.statuses.set(projectId, reordered)
      this.events?.record('status.reorder', { projectId, count: input.length })
      return undefined
    })
  }
```

(Add a small module-level `definedStatusUpdate` helper next to `definedUpdate` that keeps only defined fields.)

**Project team:**

```typescript
  listProjectTeam(projectId: string): Promise<UserRef[]> {
    return Promise.resolve().then(() => {
      this.requireProject(projectId)
      const result = this.projectTeam.get(projectId) ?? []
      this.events?.record('project.team.list', { projectId, count: result.length })
      return clone(result)
    })
  }

  addProjectMember(projectId: string, userId: string): Promise<{ projectId: string; userId: string }> {
    return Promise.resolve().then(() => {
      this.requireProject(projectId)
      const members = this.projectTeam.get(projectId) ?? []
      if (members.some((member) => member.id === userId)) throw new Error(`Project member already exists: ${userId}`)
      this.projectTeam.set(projectId, [...members, { id: userId }])
      this.events?.record('project.team.add', { projectId, userId })
      return { projectId, userId }
    })
  }

  removeProjectMember(projectId: string, userId: string): Promise<{ projectId: string; userId: string }> {
    return Promise.resolve().then(() => {
      this.requireProject(projectId)
      const members = this.projectTeam.get(projectId) ?? []
      if (!members.some((member) => member.id === userId)) throw new Error(`Project member not found: ${userId}`)
      this.projectTeam.set(projectId, members.filter((member) => member.id !== userId))
      this.events?.record('project.team.remove', { projectId, userId })
      return { projectId, userId }
    })
  }
```

- [ ] **Step 1: Write the failing contract tests first** — add to `tests/stories/harness/memory-task-provider.test.ts`:

```typescript
describe('projects', () => {
  test('creates, reads, updates, lists, and deletes projects with duplicate-name rejection', async () => {
    const provider = new MemoryTaskProvider()
    const project = await provider.createProject({ name: 'Core', description: 'core work' })
    expect(project).toMatchObject({ id: 'project-1', name: 'Core', url: 'memory://projects/project-1' })
    await expect(provider.createProject({ name: 'Core' })).rejects.toThrow('Project already exists: Core')

    await expect(provider.getProject('project-1')).resolves.toMatchObject({ name: 'Core' })
    await expect(provider.updateProject('project-1', { name: 'Core 2' })).resolves.toMatchObject({ name: 'Core 2' })
    await expect(provider.listProjects()).resolves.toHaveLength(1)
    await expect(provider.deleteProject('project-1')).resolves.toEqual({ id: 'project-1' })
    await expect(provider.listProjects()).resolves.toHaveLength(0)
    await expect(provider.getProject('project-1')).rejects.toThrow('Project not found: project-1')
  })
})

describe('statuses', () => {
  test('requires confirmation for mutations and orders by position', async () => {
    const provider = new MemoryTaskProvider()
    await provider.createProject({ name: 'Core' })

    const refused = await provider.createStatus('project-1', { name: 'In Review' })
    expect(refused).toMatchObject({ status: 'confirmation_required' })
    await expect(provider.listStatuses('project-1')).resolves.toHaveLength(0)

    const created = await provider.createStatus('project-1', { name: 'In Review' }, true)
    expect(created).toMatchObject({ id: 'status-1', name: 'In Review', order: 0 })
    await provider.createStatus('project-1', { name: 'Done', isFinal: true }, true)
    await provider.reorderStatuses(
      'project-1',
      [
        { id: 'status-2', position: 0 },
        { id: 'status-1', position: 1 },
      ],
      true,
    )
    const ordered = await provider.listStatuses('project-1')
    expect(ordered.map((column) => column.name)).toEqual(['Done', 'In Review'])

    await expect(provider.deleteStatus('project-1', 'status-1')).resolves.toMatchObject({
      status: 'confirmation_required',
    })
    await expect(provider.deleteStatus('project-1', 'status-1', true)).resolves.toEqual({ id: 'status-1' })
    await expect(provider.listStatuses('project-1')).resolves.toHaveLength(1)
  })
})

describe('project team', () => {
  test('adds, lists, and removes members with duplicate and missing errors', async () => {
    const provider = new MemoryTaskProvider()
    await provider.createProject({ name: 'Core' })

    await expect(provider.addProjectMember('project-1', 'alice')).resolves.toEqual({
      projectId: 'project-1',
      userId: 'alice',
    })
    await expect(provider.addProjectMember('project-1', 'alice')).rejects.toThrow(
      'Project member already exists: alice',
    )
    await expect(provider.listProjectTeam('project-1')).resolves.toEqual([{ id: 'alice' }])
    await expect(provider.removeProjectMember('project-1', 'alice')).resolves.toEqual({
      projectId: 'project-1',
      userId: 'alice',
    })
    await expect(provider.removeProjectMember('project-1', 'alice')).rejects.toThrow('Project member not found: alice')
    await expect(provider.listProjectTeam('project-1')).resolves.toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test --path-ignore-patterns '' tests/stories/harness/memory-task-provider.test.ts`
Expected: FAIL — the new methods do not exist.

- [ ] **Step 3: Implement** (the code above)

- [ ] **Step 4: Run to verify they pass**

Run: `bun test --path-ignore-patterns '' tests/stories/harness/memory-task-provider.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/stories/harness/memory-task-provider.ts tests/stories/harness/memory-task-provider.test.ts
git commit -m "test(stories): add projects, statuses, and project team to the memory provider"
```

---

### Task 3: Provider — relations, worklog, sprints, saved queries + seed helpers

**Files:**

- Modify: `tests/stories/harness/memory-task-provider.ts`
- Test: `tests/stories/harness/memory-task-provider.test.ts`

- [ ] **Step 1: Write the failing contract tests**

```typescript
describe('relations', () => {
  test('adds, updates, and removes relations with duplicate and missing errors', async () => {
    const provider = new MemoryTaskProvider()
    const first = await provider.createTask({ projectId: 'proj-1', title: 'First' })
    const second = await provider.createTask({ projectId: 'proj-1', title: 'Second' })

    await expect(provider.addRelation(first.id, second.id, 'blocks')).resolves.toEqual({
      taskId: first.id,
      relatedTaskId: second.id,
      type: 'blocks',
    })
    await expect(provider.addRelation(first.id, second.id, 'related')).rejects.toThrow(
      `Task relation already exists: ${first.id} ${second.id}`,
    )
    await expect(provider.updateRelation(first.id, second.id, 'related')).resolves.toEqual({
      taskId: first.id,
      relatedTaskId: second.id,
      type: 'related',
    })
    await expect(provider.removeRelation(first.id, second.id)).resolves.toEqual({
      taskId: first.id,
      relatedTaskId: second.id,
    })
    await expect(provider.removeRelation(first.id, second.id)).rejects.toThrow(
      `Task relation not found: ${first.id} ${second.id}`,
    )
    await expect(provider.updateRelation(first.id, second.id, 'blocks')).rejects.toThrow(
      `Task relation not found: ${first.id} ${second.id}`,
    )
  })

  test('requires both tasks to exist', async () => {
    const provider = new MemoryTaskProvider()
    const task = await provider.createTask({ projectId: 'proj-1', title: 'First' })

    await expect(provider.addRelation(task.id, 'task-404', 'blocks')).rejects.toThrow('Task not found: task-404')
  })
})

describe('worklog', () => {
  test('logs, lists, updates, and deletes work items with defaults', async () => {
    const provider = new MemoryTaskProvider()
    const task = await provider.createTask({ projectId: 'proj-1', title: 'Worked' })

    const item = await provider.createWorkItem(task.id, { duration: 'PT1H30M', description: 'deep work' })
    expect(item).toMatchObject({
      id: 'work-1',
      taskId: task.id,
      duration: 'PT1H30M',
      author: 'unknown',
      date: '2026-01-01',
    })
    await expect(provider.listWorkItems(task.id)).resolves.toHaveLength(1)
    await expect(provider.updateWorkItem(task.id, 'work-1', { duration: 'PT2H' })).resolves.toMatchObject({
      duration: 'PT2H',
    })
    await expect(provider.deleteWorkItem(task.id, 'work-1')).resolves.toEqual({ id: 'work-1' })
    await expect(provider.deleteWorkItem(task.id, 'work-1')).rejects.toThrow('Work item not found: work-1')
  })
})

describe('sprints and saved queries', () => {
  test('manages agiles, sprints, and task assignment', async () => {
    const provider = new MemoryTaskProvider()
    const agile = provider.addAgile({ name: 'Main Board' })
    expect(agile).toEqual({ id: 'agile-1', name: 'Main Board' })
    await expect(provider.listAgiles()).resolves.toEqual([{ id: 'agile-1', name: 'Main Board' }])

    const sprint = await provider.createSprint('agile-1', { name: 'Sprint 1', goal: 'ship' })
    expect(sprint).toMatchObject({ id: 'sprint-1', agileId: 'agile-1', archived: false, goal: 'ship' })
    await expect(provider.listSprints('agile-1')).resolves.toHaveLength(1)
    await expect(provider.updateSprint('agile-1', 'sprint-1', { goal: 'ship harder' })).resolves.toMatchObject({
      goal: 'ship harder',
    })
    await expect(provider.listSprints('agile-404')).rejects.toThrow('Agile not found: agile-404')

    const task = await provider.createTask({ projectId: 'proj-1', title: 'Planned' })
    await expect(provider.assignTaskToSprint(task.id, 'sprint-1')).resolves.toEqual({
      taskId: task.id,
      sprintId: 'sprint-1',
    })
    expect(provider.taskSprintId(task.id)).toBe('sprint-1')
  })

  test('runs saved queries through search semantics', async () => {
    const provider = new MemoryTaskProvider()
    await provider.createTask({ projectId: 'proj-1', title: 'Release 7' })
    await provider.createTask({ projectId: 'proj-1', title: 'Backlog grooming' })
    const query = provider.addSavedQuery({ name: 'Releases', query: 'release' })

    expect(query).toEqual({ id: 'query-1', name: 'Releases', query: 'release' })
    await expect(provider.listSavedQueries()).resolves.toEqual([{ id: 'query-1', name: 'Releases', query: 'release' }])
    const results = await provider.runSavedQuery('query-1')
    expect(results.map((task) => task.title)).toEqual(['Release 7'])
    await expect(provider.runSavedQuery('query-404')).rejects.toThrow('Saved query not found: query-404')
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `bun test --path-ignore-patterns '' tests/stories/harness/memory-task-provider.test.ts`
Expected: FAIL — methods do not exist.

- [ ] **Step 3: Implement**

```typescript
  addRelation(taskId: string, relatedTaskId: string, type: RelationType): Promise<{ taskId: string; relatedTaskId: string; type: string }> {
    return Promise.resolve().then(() => {
      this.requireTask(taskId)
      this.requireTask(relatedTaskId)
      const relations = this.relations.get(taskId) ?? new Map<string, RelationType>()
      if (relations.has(relatedTaskId)) throw new Error(`Task relation already exists: ${taskId} ${relatedTaskId}`)
      relations.set(relatedTaskId, type)
      this.relations.set(taskId, relations)
      this.events?.record('task.relation.create', { taskId, relatedTaskId, type })
      return { taskId, relatedTaskId, type }
    })
  }

  updateRelation(taskId: string, relatedTaskId: string, type: RelationType): Promise<{ taskId: string; relatedTaskId: string; type: string }> {
    return Promise.resolve().then(() => {
      this.requireTask(taskId)
      this.requireTask(relatedTaskId)
      const relations = this.relations.get(taskId)
      if (relations === undefined || !relations.has(relatedTaskId)) throw new Error(`Task relation not found: ${taskId} ${relatedTaskId}`)
      relations.set(relatedTaskId, type)
      this.events?.record('task.relation.update', { taskId, relatedTaskId, type })
      return { taskId, relatedTaskId, type }
    })
  }

  removeRelation(taskId: string, relatedTaskId: string): Promise<{ taskId: string; relatedTaskId: string }> {
    return Promise.resolve().then(() => {
      const relations = this.relations.get(taskId)
      if (relations === undefined || !relations.delete(relatedTaskId)) throw new Error(`Task relation not found: ${taskId} ${relatedTaskId}`)
      this.events?.record('task.relation.delete', { taskId, relatedTaskId })
      return { taskId, relatedTaskId }
    })
  }

  listWorkItems(taskId: string, params: Readonly<{ limit?: number; offset?: number }> = {}): Promise<WorkItem[]> {
    return Promise.resolve().then(() => {
      this.requireTask(taskId)
      const items = this.workItems.get(taskId) ?? []
      const offset = Math.max(0, params.offset ?? 0)
      const limit = params.limit ?? items.length
      const result = items.slice(offset, offset + limit)
      this.events?.record('work.list', { taskId, count: result.length })
      return clone(result)
    })
  }

  createWorkItem(taskId: string, params: CreateWorkItemParams): Promise<WorkItem> {
    const input = clone(params)
    return Promise.resolve().then(() => {
      this.requireTask(taskId)
      const item: WorkItem = {
        id: `work-${++this.workSequence}`,
        taskId,
        author: input.author ?? 'unknown',
        date: input.date ?? '2026-01-01',
        duration: input.duration,
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.type === undefined ? {} : { type: input.type }),
      }
      this.workItems.set(taskId, [...(this.workItems.get(taskId) ?? []), clone(item)])
      this.events?.record('work.create', { taskId, workItemId: item.id })
      return clone(item)
    })
  }

  updateWorkItem(taskId: string, workItemId: string, params: UpdateWorkItemParams): Promise<WorkItem> {
    const input = clone(params)
    return Promise.resolve().then(() => {
      this.requireTask(taskId)
      const items = this.workItems.get(taskId) ?? []
      const existing = items.find((item) => item.id === workItemId)
      if (existing === undefined) throw new Error(`Work item not found: ${workItemId}`)
      const updated: WorkItem = {
        ...existing,
        ...(input.duration === undefined ? {} : { duration: input.duration }),
        ...(input.date === undefined ? {} : { date: input.date }),
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.type === undefined ? {} : { type: input.type }),
      }
      this.workItems.set(taskId, items.map((item) => (item.id === workItemId ? clone(updated) : item)))
      this.events?.record('work.update', { taskId, workItemId })
      return clone(updated)
    })
  }

  deleteWorkItem(taskId: string, workItemId: string): Promise<{ id: string }> {
    return Promise.resolve().then(() => {
      this.requireTask(taskId)
      const items = this.workItems.get(taskId) ?? []
      if (!items.some((item) => item.id === workItemId)) throw new Error(`Work item not found: ${workItemId}`)
      this.workItems.set(taskId, items.filter((item) => item.id !== workItemId))
      this.events?.record('work.delete', { taskId, workItemId })
      return { id: workItemId }
    })
  }

  addAgile(input: Readonly<{ name: string }>): Agile {
    const agile: Agile = { id: `agile-${++this.agileSequence}`, name: input.name }
    this.agiles.set(agile.id, clone(agile))
    return clone(agile)
  }

  listAgiles(): Promise<Agile[]> {
    return Promise.resolve().then(() => {
      const result = [...this.agiles.values()]
      this.events?.record('agile.list', { count: result.length })
      return clone(result)
    })
  }

  listSprints(agileId: string): Promise<Sprint[]> {
    return Promise.resolve().then(() => {
      this.requireAgile(agileId)
      const result = this.sprints.get(agileId) ?? []
      this.events?.record('sprint.list', { agileId, count: result.length })
      return clone(result)
    })
  }

  createSprint(agileId: string, params: Readonly<{ name: string; goal?: string; start?: string; finish?: string; previousSprintId?: string; isDefault?: boolean }>): Promise<Sprint> {
    const input = clone(params)
    return Promise.resolve().then(() => {
      this.requireAgile(agileId)
      const sprint: Sprint = {
        id: `sprint-${++this.sprintSequence}`,
        agileId,
        name: input.name,
        archived: false,
        ...(input.goal === undefined ? {} : { goal: input.goal }),
        ...(input.start === undefined ? {} : { start: input.start }),
        ...(input.finish === undefined ? {} : { finish: input.finish }),
        ...(input.isDefault === undefined ? {} : { isDefault: input.isDefault }),
      }
      this.sprints.set(agileId, [...(this.sprints.get(agileId) ?? []), clone(sprint)])
      this.events?.record('sprint.create', { agileId, sprintId: sprint.id })
      return clone(sprint)
    })
  }

  updateSprint(agileId: string, sprintId: string, params: Readonly<{ name?: string; goal?: string | null; start?: string | null; finish?: string | null; archived?: boolean }>): Promise<Sprint> {
    const input = clone(params)
    return Promise.resolve().then(() => {
      const sprint = this.requireSprint(agileId, sprintId)
      const updated: Sprint = {
        ...sprint,
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.goal === undefined ? {} : { goal: input.goal }),
        ...(input.start === undefined ? {} : { start: input.start }),
        ...(input.finish === undefined ? {} : { finish: input.finish }),
        ...(input.archived === undefined ? {} : { archived: input.archived }),
      }
      this.sprints.set(agileId, (this.sprints.get(agileId) ?? []).map((entry) => (entry.id === sprintId ? clone(updated) : entry)))
      this.events?.record('sprint.update', { agileId, sprintId })
      return clone(updated)
    })
  }

  assignTaskToSprint(taskId: string, sprintId: string): Promise<{ taskId: string; sprintId: string }> {
    return Promise.resolve().then(() => {
      this.requireTask(taskId)
      const agileId = [...this.sprints.entries()].find(([, sprints]) => sprints.some((sprint) => sprint.id === sprintId))?.[0]
      if (agileId === undefined) throw new Error(`Sprint not found: ${sprintId}`)
      this.taskSprints.set(taskId, sprintId)
      this.events?.record('sprint.assign', { taskId, sprintId })
      return { taskId, sprintId }
    })
  }

  taskSprintId(taskId: string): string | undefined {
    return this.taskSprints.get(taskId)
  }

  addSavedQuery(input: Readonly<{ name: string; query?: string }>): SavedQuery {
    const savedQuery: SavedQuery = { id: `query-${++this.querySequence}`, name: input.name, ...(input.query === undefined ? {} : { query: input.query }) }
    this.savedQueries.set(savedQuery.id, clone(savedQuery))
    return clone(savedQuery)
  }

  listSavedQueries(): Promise<SavedQuery[]> {
    return Promise.resolve().then(() => {
      const result = [...this.savedQueries.values()]
      this.events?.record('query.list', { count: result.length })
      return clone(result)
    })
  }

  runSavedQuery(queryId: string): Promise<TaskSearchResult[]> {
    return Promise.resolve().then(async () => {
      const savedQuery = this.savedQueries.get(queryId)
      if (savedQuery === undefined) throw new Error(`Saved query not found: ${queryId}`)
      this.events?.record('query.run', { queryId })
      if (savedQuery.query === undefined || savedQuery.query === null || savedQuery.query === '') {
        return clone([...this.tasks.values()].map(taskSearchResult))
      }
      return this.searchTasks({ query: savedQuery.query })
    })
  }

  private requireAgile(agileId: string): Agile {
    const agile = this.agiles.get(agileId)
    if (agile === undefined) throw new Error(`Agile not found: ${agileId}`)
    return agile
  }

  private requireSprint(agileId: string, sprintId: string): Sprint {
    const sprint = (this.sprints.get(agileId) ?? []).find((entry) => entry.id === sprintId)
    if (sprint === undefined) throw new Error(`Sprint not found: agile ${agileId}, sprint ${sprintId}`)
    return sprint
  }
```

(`TaskSearchResult` is already imported; `taskSearchResult` mapper already exists in the file.)

- [ ] **Step 4: Run to verify they pass**

Run: `bun test --path-ignore-patterns '' tests/stories/harness/memory-task-provider.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/stories/harness/memory-task-provider.ts tests/stories/harness/memory-task-provider.test.ts
git commit -m "test(stories): add relations, worklog, sprints, and saved queries to the memory provider"
```

---

### Task 4: Provider-surface story file (7 scenarios)

**Files:**

- Create: `tests/stories/tasks/provider-surface.story.test.ts`

DM + `given.assign(dm, instance)` + minimal `given.taskCapabilities([...])` per scenario. Deterministic ids: `project-1`, `status-1`/`status-2`, `work-1`, `agile-1`, `sprint-1`, `query-1`, `task-1`/`task-2`. Header/imports mirror the lifecycle story file. Scenario names must match Task 5's mapping byte-for-byte.

- [ ] **Step 1: relations, statuses, projects (3 scenarios)**

```typescript
scenario('SCN-task-relations: links, retypes, and unlinks tasks', async ({ given, when, then }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  const instance = given.taskInstance()
  given.assign(dm, instance)
  given.taskCapabilities(['tasks.relations'])
  given.llm([
    callCapability('tasks.create', { projectId: 'proj-1', title: 'First' }),
    callCapability('tasks.create', { projectId: 'proj-1', title: 'Second' }),
    answer('Both created.'),
  ])

  await when.message(alice, dm, 'Create tasks First and Second')

  given.llm([
    callCapability('tasks.relations.add', { taskId: 'task-1', relatedTaskId: 'task-2', type: 'blocks' }),
    answer('First now blocks Second.'),
  ])
  await when.message(alice, dm, 'Make First block Second')
  then.replyTo(alice).equals('First now blocks Second.')

  given.llm([
    callCapability('tasks.relations.add', { taskId: 'task-1', relatedTaskId: 'task-2', type: 'related' }),
    answer('They are already linked.'),
  ])
  await when.message(alice, dm, 'Link them again')
  then.replyTo(alice).equals('They are already linked.')

  given.llm([
    callCapability('tasks.relations.update', { taskId: 'task-1', relatedTaskId: 'task-2', type: 'related' }),
    callCapability('tasks.relations.remove', { taskId: 'task-1', relatedTaskId: 'task-2' }),
    answer('Retyped, then unlinked.'),
  ])
  await when.message(alice, dm, 'Retype to related, then unlink')

  given.llm([
    callCapability('tasks.relations.remove', { taskId: 'task-1', relatedTaskId: 'task-2' }),
    answer('There is no link left to remove.'),
  ])
  await when.message(alice, dm, 'Unlink once more')
  then.replyTo(alice).equals('There is no link left to remove.')
})

scenario('SCN-task-statuses: confirms shared status mutations', async ({ given, when, then, world }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  const instance = given.taskInstance()
  given.assign(dm, instance)
  given.taskCapabilities([
    'projects.create',
    'statuses.list',
    'statuses.create',
    'statuses.update',
    'statuses.delete',
    'statuses.reorder',
  ])
  given.llm([callCapability('tasks.projects.create', { name: 'Core' }), answer('Project created.')])

  await when.message(alice, dm, 'Create project Core')

  given.llm([
    callCapability('tasks.statuses.create', { projectId: 'project-1', name: 'In Review' }),
    answer('Creating a status changes the shared set — please confirm.'),
  ])
  await when.message(alice, dm, 'Add a status In Review')
  then.replyTo(alice).equals('Creating a status changes the shared set — please confirm.')
  expect(await world.tasks.listStatuses('project-1')).toHaveLength(0)

  given.llm([
    callCapability('tasks.statuses.create', { projectId: 'project-1', name: 'In Review', confirm: true }),
    answer('Status “In Review” created.'),
  ])
  await when.message(alice, dm, 'Confirmed, add it')
  then.replyTo(alice).equals('Status “In Review” created.')
  expect((await world.tasks.listStatuses('project-1')).map((column) => column.name)).toEqual(['In Review'])

  given.llm([
    callCapability('tasks.statuses.delete', { projectId: 'project-1', statusId: 'status-1', confirm: true }),
    answer('Status deleted.'),
  ])
  await when.message(alice, dm, 'Delete the status')
  expect(await world.tasks.listStatuses('project-1')).toHaveLength(0)
})

scenario('SCN-task-projects: manages the project catalogue', async ({ given, when, then, world }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  const instance = given.taskInstance()
  given.assign(dm, instance)
  given.taskCapabilities(['projects.read', 'projects.list', 'projects.create', 'projects.update', 'projects.delete'])
  given.llm([
    callCapability('tasks.projects.create', { name: 'Core', description: 'core work' }),
    answer('Project “Core” created.'),
  ])

  await when.message(alice, dm, 'Create project Core')

  given.llm([
    callCapability('tasks.projects.get', { projectId: 'project-1' }),
    callCapability('tasks.projects.update', { projectId: 'project-1', name: 'Core 2' }),
    callCapability('tasks.projects.list', {}),
    answer('Renamed to “Core 2” — one project total.'),
  ])
  await when.message(alice, dm, 'Rename it and list projects')
  then.replyTo(alice).equals('Renamed to “Core 2” — one project total.')

  given.llm([
    callCapability('tasks.projects.create', { name: 'Core 2' }),
    answer('A project named “Core 2” already exists.'),
  ])
  await when.message(alice, dm, 'Create it again')
  then.replyTo(alice).equals('A project named “Core 2” already exists.')

  given.llm([callCapability('tasks.projects.delete', { projectId: 'project-1', confidence: 0.9 }), answer('Deleted.')])
  await when.message(alice, dm, 'Delete the project')
  expect(await world.tasks.listProjects()).toHaveLength(0)
})
```

(Every scenario's seeded capability set must cover every scripted call's gate from the tool inventory — e.g. `create_project` needs `projects.create`, `create_status` needs `statuses.create`. Verify against the actual tool-assembly gates at runtime; report any adjustments.)

- [ ] **Step 2: project-team, worklog, sprints, saved-queries (4 scenarios)**

```typescript
scenario('SCN-task-project-team: manages project membership', async ({ given, when, then, world }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  const instance = given.taskInstance()
  given.assign(dm, instance)
  given.taskCapabilities(['projects.create', 'projects.team'])
  given.llm([callCapability('tasks.projects.create', { name: 'Core' }), answer('Project created.')])

  await when.message(alice, dm, 'Create project Core')

  given.llm([
    callCapability('tasks.projects.team.add', { projectId: 'project-1', userId: 'alice' }),
    callCapability('tasks.projects.team.list', { projectId: 'project-1' }),
    answer('alice is on the team.'),
  ])
  await when.message(alice, dm, 'Add me to the team and list it')
  then.replyTo(alice).equals('alice is on the team.')
  expect(await world.tasks.listProjectTeam('project-1')).toEqual([{ id: 'alice' }])

  given.llm([
    callCapability('tasks.projects.team.add', { projectId: 'project-1', userId: 'alice' }),
    answer('alice is already on the team.'),
  ])
  await when.message(alice, dm, 'Add me again')
  then.replyTo(alice).equals('alice is already on the team.')

  given.llm([
    callCapability('tasks.projects.team.remove', { projectId: 'project-1', userId: 'alice' }),
    answer('Removed from the team.'),
  ])
  await when.message(alice, dm, 'Remove me')
  expect(await world.tasks.listProjectTeam('project-1')).toEqual([])
})

scenario('SCN-task-worklog: logs and edits work items', async ({ given, when, then, world }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  const instance = given.taskInstance()
  given.assign(dm, instance)
  given.taskCapabilities(['workItems.list', 'workItems.create', 'workItems.update', 'workItems.delete'])
  given.llm([callCapability('tasks.create', { projectId: 'proj-1', title: 'Worked' }), answer('Created.')])

  await when.message(alice, dm, 'Create task Worked')

  given.llm([
    callCapability('tasks.worklog.create', { taskId: 'task-1', duration: 'PT1H30M', description: 'deep work' }),
    callCapability('tasks.worklog.list', { taskId: 'task-1' }),
    answer('Logged 1h 30m of deep work.'),
  ])
  await when.message(alice, dm, 'Log 90 minutes of deep work')
  then.replyTo(alice).equals('Logged 1h 30m of deep work.')
  expect(await world.tasks.listWorkItems('task-1')).toHaveLength(1)

  given.llm([
    callCapability('tasks.worklog.update', { taskId: 'task-1', workItemId: 'work-1', duration: 'PT2H' }),
    answer('Updated to 2 hours.'),
  ])
  await when.message(alice, dm, 'Make it 2 hours')
  expect((await world.tasks.listWorkItems('task-1')).at(0)?.duration).toBe('PT2H')

  given.llm([
    callCapability('tasks.worklog.delete', { taskId: 'task-1', workItemId: 'work-1', confidence: 0.9 }),
    answer('Work item removed.'),
  ])
  await when.message(alice, dm, 'Remove the work item')
  expect(await world.tasks.listWorkItems('task-1')).toHaveLength(0)
})

scenario('SCN-task-sprints: plans work on an agile board', async ({ given, when, then, world }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  const instance = given.taskInstance()
  given.assign(dm, instance)
  given.taskCapabilities(['agiles.list', 'sprints.list', 'sprints.create', 'sprints.update', 'sprints.assign'])
  world.tasks.addAgile({ name: 'Main Board' })
  given.llm([callCapability('tasks.create', { projectId: 'proj-1', title: 'Planned' }), answer('Created.')])

  await when.message(alice, dm, 'Create task Planned')

  given.llm([
    callCapability('tasks.agiles.list', {}),
    callCapability('tasks.sprints.create', { agileId: 'agile-1', name: 'Sprint 1', goal: 'ship' }),
    answer('Sprint 1 created on Main Board.'),
  ])
  await when.message(alice, dm, 'Create Sprint 1 with goal ship')

  given.llm([
    callCapability('tasks.sprints.list', { agileId: 'agile-1' }),
    callCapability('tasks.sprints.assign', { taskId: 'task-1', sprintId: 'sprint-1' }),
    answer('“Planned” is in Sprint 1.'),
  ])
  await when.message(alice, dm, 'Put the task in the sprint')
  then.replyTo(alice).equals('“Planned” is in Sprint 1.')
  expect(world.tasks.taskSprintId('task-1')).toBe('sprint-1')
})

scenario('SCN-task-saved-queries: lists and runs saved queries', async ({ given, when, then, world }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  const instance = given.taskInstance()
  given.assign(dm, instance)
  given.taskCapabilities(['queries.saved'])
  world.tasks.addSavedQuery({ name: 'Releases', query: 'release' })
  world.tasks.addSavedQuery({ name: 'Everything' })
  given.llm([
    callCapability('tasks.create', { projectId: 'proj-1', title: 'Release 7' }),
    callCapability('tasks.create', { projectId: 'proj-1', title: 'Backlog grooming' }),
    answer('Seeded.'),
  ])

  await when.message(alice, dm, 'Seed the demo tasks')

  given.llm([callCapability('tasks.queries.saved.list', {}), answer('Two saved queries: Releases and Everything.')])
  await when.message(alice, dm, 'What saved queries exist?')
  then.replyTo(alice).equals('Two saved queries: Releases and Everything.')

  given.llm([
    callCapability('tasks.queries.saved.run', { queryId: 'query-1' }),
    answer('Releases matches “Release 7”.'),
  ])
  await when.message(alice, dm, 'Run the Releases query')
  then.replyTo(alice).equals('Releases matches “Release 7”.')
})
```

(`world.tasks.addAgile`/`addSavedQuery` are synchronous provider test API — call them in the given phase; `world` is available in the scenario callback.)

- [ ] **Step 3: Run the story file**

Run: `bun test:stories`
Expected: 73 pass / 0 fail (66 + 7).

- [ ] **Step 4: Commit**

```bash
git add tests/stories/tasks/provider-surface.story.test.ts
git commit -m "test(stories): cover the task provider surface"
```

---

### Task 5: Ledger update

**Files:**

- Modify: `tests/stories/catalog/coverage.ts`
- Test: `tests/stories/harness/catalog-coverage.test.ts`, `tests/scripts/story-coverage-totals.test.ts`

- [ ] **Step 1: Update the failing contract tests first**

`tracks the executable coverage total` 58 → `65`; `audit records cover exactly the pending scenarios` 70 → `63`; `audit readiness totals` → `2`, `39`, `22`. Totals test: `{ total: 128, executable: 65, pending: 63, readiness: { 'executable-as-is': 2, 'needs-seam': 39, blocked: 22 } }` and format string `'story catalog: 65/128 executable; pending 63 (2 executable-as-is, 39 needs-seam, 22 blocked)'`.

- [ ] **Step 2: Run to verify they fail**

Run: `bun test --path-ignore-patterns '' tests/stories/harness/catalog-coverage.test.ts && bun test tests/scripts/story-coverage-totals.test.ts`
Expected: FAIL — stale counts.

- [ ] **Step 3: Move the 7 entries**

Delete from `AUDIT_RECORDS`: `SCN-task-relations`, `-statuses`, `-projects`, `-project-team`, `-worklog`, `-sprints`, `-saved-queries`. Add to `EXECUTABLE_STORY_MAPPINGS` with `verifiedAt: '2026-07-19'` — copy scenario names from the story file byte-for-byte:

```typescript
  'SCN-task-relations': {
    verifiedAt: '2026-07-19',
    storyIds: ['tests/stories/tasks/provider-surface.story.test.ts#SCN-task-relations: links, retypes, and unlinks tasks'],
  },
  'SCN-task-statuses': {
    verifiedAt: '2026-07-19',
    storyIds: ['tests/stories/tasks/provider-surface.story.test.ts#SCN-task-statuses: confirms shared status mutations'],
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
    storyIds: ['tests/stories/tasks/provider-surface.story.test.ts#SCN-task-saved-queries: lists and runs saved queries'],
  },
```

- [ ] **Step 4: Run the ledger tests to verify they pass**

Run: `bun test --path-ignore-patterns '' tests/stories/harness/catalog-coverage.test.ts && bun test tests/scripts/story-coverage-totals.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/stories/catalog/coverage.ts tests/stories/harness/catalog-coverage.test.ts tests/scripts/story-coverage-totals.test.ts
git commit -m "test(stories): map F2b-1 provider-surface scenarios in the catalog"
```

---

### Task 6: Final verification gate

- [ ] **Step 1: Sandboxed story suite** — `bun test:stories` → 73 pass / 0 fail.
- [ ] **Step 2: Sandboxed contract suites** — `bun test:stories:contracts` → all pass.
- [ ] **Step 3: Runner and touched unit suites** — `bun test tests/scripts/ tests/tools/core-capabilities.test.ts` → all pass.
- [ ] **Step 4: Typecheck and lint** — `bun run typecheck && bun run lint` → clean.
- [ ] **Step 5: Fresh manifest, totals line, compat** — `bun test:stories:manifest 2>&1 | grep "story catalog"` → `story catalog: 65/128 executable; pending 63 (2 executable-as-is, 39 needs-seam, 22 blocked)`; manifest scenario count is 74 (67 + 7). Then `git status --short` (clean) and `bun scripts/story/test-stories.ts --compat --baseline-ref HEAD --manifest-only` → exit 0.
