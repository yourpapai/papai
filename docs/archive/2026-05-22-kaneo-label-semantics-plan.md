<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Kaneo Label Semantics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Kaneo label handling scope-aware so papai only treats reusable workspace labels as creatable/reusable, reports `already_exists` / `already_present` / `already_absent` as structured non-fatal statuses, and ships safe SQL cleanup scripts for redundant label rows.

**Architecture:** We will keep the behavior change Kaneo-specific by teaching the Kaneo provider to expose two views of labels: reusable workspace labels from `listLabels()` and task-attached labels from a new `listTaskLabels(taskId)` method. Then the shared label tools will branch on `provider.name === 'kaneo'` and use those richer Kaneo semantics to avoid duplicate creation and redundant task-label mutations. Finally, we will add read-only preview and safe consolidation SQL scripts that only deduplicate reusable workspace labels and duplicate same-name rows on the same task.

**Tech Stack:** Bun, TypeScript, Zod v4, Vercel AI SDK tools, PostgreSQL, Docker Compose

---

## Task 1: Add Kaneo provider support for reusable labels and task labels

**Files:**

- Modify: `src/providers/types.ts:200-206`
- Modify: `src/providers/kaneo/label-resource.ts:50-164`
- Create: `src/providers/kaneo/list-task-labels.ts`
- Modify: `src/providers/kaneo/operations/labels.ts:1-60`
- Modify: `src/providers/kaneo/index.ts:155-177`
- Modify: `tests/providers/kaneo/label-resource.test.ts:173-420`
- Modify: `tests/providers/kaneo/index.test.ts:74-220`
- Modify: `tests/tools/mock-provider.ts:141-146`

- [x] **Step 1: Write the failing provider tests**

Update `tests/providers/kaneo/label-resource.test.ts` by adding a new `describe('listForTask', ...)` block after the existing `describe('list', ...)` block:

```typescript
describe('listForTask', () => {
  test('returns all labels attached to a task', async () => {
    const requests: Array<{ url: string; method: string }> = []
    setMockFetch((url, options) => {
      requests.push({ url, method: getRequestMethod(options) })
      return Promise.resolve(
        new Response(
          JSON.stringify([
            { id: 'label-1', name: 'Feature', color: '#ff0000', taskId: 'task-1' },
            { id: 'label-2', name: 'archived', color: '#6b7280', taskId: 'task-1' },
          ]),
          { status: 200 },
        ),
      )
    })

    const resource = new LabelResource(mockConfig)
    const result = await resource.listForTask('task-1')

    expect(requests).toEqual([
      {
        url: 'https://api.test.com/api/label/task/task-1',
        method: 'GET',
      },
    ])
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ id: 'label-1', name: 'Feature', taskId: 'task-1' })
    expect(result[1]).toMatchObject({ id: 'label-2', name: 'archived', taskId: 'task-1' })
  })
})
```

Update `tests/providers/kaneo/index.test.ts` by adding this new `describe('labels', ...)` block after `describe('identity', ...)`:

```typescript
describe('labels', () => {
  test('listLabels returns reusable workspace labels only', async () => {
    setMockFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify([
            { id: 'label-1', name: 'Feature', color: '#ff0000', taskId: null },
            { id: 'label-2', name: 'Feature', color: '#ff0000', taskId: 'task-1' },
            { id: 'label-3', name: 'archived', color: '#6b7280', taskId: null },
          ]),
          { status: 200 },
        ),
      ),
    )

    const result = await provider.listLabels()

    expect(result).toEqual([
      { id: 'label-1', name: 'Feature', color: '#ff0000' },
      { id: 'label-3', name: 'archived', color: '#6b7280' },
    ])
  })

  test('listTaskLabels returns labels currently attached to a task', async () => {
    setMockFetch((url) => {
      expect(url).toContain('/api/label/task/task-1')
      return Promise.resolve(
        new Response(
          JSON.stringify([
            { id: 'task-label-1', name: 'Feature', color: '#ff0000', taskId: 'task-1' },
            { id: 'task-label-2', name: 'archived', color: '#6b7280', taskId: 'task-1' },
          ]),
          { status: 200 },
        ),
      )
    })

    const result = await provider.listTaskLabels!('task-1')

    expect(result).toEqual([
      { id: 'task-label-1', name: 'Feature', color: '#ff0000' },
      { id: 'task-label-2', name: 'archived', color: '#6b7280' },
    ])
  })
})
```

- [x] **Step 2: Run the provider tests to verify they fail**

Run:

```bash
bun test tests/providers/kaneo/label-resource.test.ts tests/providers/kaneo/index.test.ts
```

Expected: FAIL because `LabelResource.listForTask()` and `KaneoProvider.listTaskLabels()` do not exist, and `listLabels()` still returns task-bound rows.

- [x] **Step 3: Add the provider contract and Kaneo resource methods**

Modify `src/providers/types.ts` by extending the label section:

```typescript
  listLabels?(): Promise<Label[]>
  listTaskLabels?(taskId: string): Promise<TaskLabel[]>
  getLabelByName?(labelName: string): Promise<Label[]>
  createLabel?(params: { name: string; color?: string }): Promise<Label>
```

Modify `tests/tools/mock-provider.ts` so the shared mock provider understands the new optional method:

```typescript
    listLabels: mock(() => Promise.resolve([])),
    listTaskLabels: mock(() => Promise.resolve([])),
    createLabel: mock(() => Promise.resolve({ id: 'label-1', name: 'test' })),
```

Modify `src/providers/kaneo/label-resource.ts` by adding `listForTask()` directly after `list()`:

```typescript
  async listForTask(taskId: string): Promise<z.infer<typeof CreateLabelResponseSchema>[]> {
    this.log.debug({ taskId }, 'Listing task labels')

    try {
      const labels = await kaneoFetch(
        this.config,
        'GET',
        `/label/task/${taskId}`,
        undefined,
        undefined,
        z.array(CreateLabelResponseSchema),
      )
      this.log.info({ taskId, count: labels.length }, 'Task labels listed')
      return labels
    } catch (error) {
      this.log.error({ error: error instanceof Error ? error.message : String(error), taskId }, 'Failed to list task labels')
      throw classifyKaneoError(error)
    }
  }
```

Create `src/providers/kaneo/list-task-labels.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { logger } from '../../logger.js'
import { classifyKaneoError } from './classify-error.js'
import type { KaneoConfig } from './client.js'
import { KaneoClient } from './kaneo-client.js'
import { CreateLabelResponseSchema } from './schemas/create-label.js'

const log = logger.child({ scope: 'kaneo:list-task-labels' })

type KaneoTaskLabel = z.infer<typeof CreateLabelResponseSchema>

export async function listTaskLabels({
  config,
  taskId,
}: {
  config: KaneoConfig
  taskId: string
}): Promise<KaneoTaskLabel[]> {
  log.debug({ taskId }, 'listTaskLabels called')

  try {
    const client = new KaneoClient(config)
    const labels = await client.labels.listForTask(taskId)
    log.info({ taskId, labelCount: labels.length }, 'Task labels listed')
    return labels
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), taskId }, 'listTaskLabels failed')
    throw classifyKaneoError(error)
  }
}
```

- [x] **Step 4: Filter Kaneo workspace labels and expose task labels from the provider**

Modify `src/providers/kaneo/operations/labels.ts`. The actual implementation uses an `isReusableWorkspaceLabel` predicate that accepts both `taskId === null` and `taskId === undefined`, because some API responses omit the field entirely rather than returning `null`:

```typescript
const isReusableWorkspaceLabel = (label: { taskId?: string | null }): boolean => {
  if (label.taskId === null) return true
  if (label.taskId === undefined) return true
  return false
}

export async function kaneoListLabels(config: KaneoConfig, workspaceId: string): Promise<Label[]> {
  const results = await listLabels({ config, workspaceId })
  return results.filter(isReusableWorkspaceLabel).map(mapLabel)
}

export async function kaneoListTaskLabels(config: KaneoConfig, taskId: string): Promise<TaskLabel[]> {
  const results = await listTaskLabels({ config, taskId })
  return results.map((label) => mapTaskLabel(label))
}
```

Modify `src/providers/kaneo/index.ts` label section:

```typescript
  listLabels(): Promise<Label[]> {
    return kaneoListLabels(this.config, this.workspaceId)
  }

  listTaskLabels(taskId: string): Promise<TaskLabel[]> {
    return kaneoListTaskLabels(this.config, taskId)
  }
```

- [x] **Step 5: Run the provider tests to verify they pass**

Run:

```bash
bun test tests/providers/kaneo/label-resource.test.ts tests/providers/kaneo/index.test.ts
```

Expected: PASS, including the new task-label endpoint coverage and the reusable-label filtering behavior.

- [x] **Step 6: Commit the provider changes**

Run:

```bash
git add src/providers/types.ts src/providers/kaneo/label-resource.ts src/providers/kaneo/list-task-labels.ts src/providers/kaneo/operations/labels.ts src/providers/kaneo/index.ts tests/providers/kaneo/label-resource.test.ts tests/providers/kaneo/index.test.ts tests/tools/mock-provider.ts
git commit -m "fix(kaneo): distinguish reusable and task labels"
```

---

## Task 2: Add Kaneo-only `already_exists` handling to `create_label`

**Files:**

- Create: `src/tools/kaneo-label-helpers.ts`
- Modify: `src/tools/create-label.ts:1-34`
- Modify: `tests/tools/label-tools.test.ts:113-193`

- [x] **Step 1: Write the failing create-label tests**

Add these tests inside `describe('makeCreateLabelTool', ...)` in `tests/tools/label-tools.test.ts`:

```typescript
test('returns already_exists for Kaneo when reusable workspace label already exists', async () => {
  const createLabel = mock(() => Promise.resolve({ id: 'label-new', name: 'Feature', color: '#ff0000' }))
  const provider = createMockProvider({
    name: 'kaneo',
    listLabels: mock(() => Promise.resolve([{ id: 'label-1', name: 'Feature', color: '#ff0000' }])),
    createLabel,
  })

  const tool = makeCreateLabelTool(provider)
  assert(tool.execute, 'Tool execute is undefined')
  const result: unknown = await tool.execute({ name: 'Feature' }, { toolCallId: '1', messages: [] })

  expect(result).toMatchObject({
    status: 'already_exists',
    labelName: 'Feature',
    existingLabelIds: ['label-1'],
  })
  expect(createLabel).not.toHaveBeenCalled()
})

test('keeps existing create behavior for non-Kaneo providers', async () => {
  const createLabel = mock((params: { name: string; color?: string }) =>
    Promise.resolve({ id: 'label-1', name: params.name, color: params.color }),
  )
  const provider = createMockProvider({
    name: 'youtrack',
    listLabels: mock(() => Promise.resolve([{ id: 'label-existing', name: 'Feature', color: '#ff0000' }])),
    createLabel,
  })

  const tool = makeCreateLabelTool(provider)
  assert(tool.execute, 'Tool execute is undefined')
  const result: unknown = await tool.execute({ name: 'Feature' }, { toolCallId: '1', messages: [] })

  expect(result).toMatchObject({ id: 'label-1', name: 'Feature', color: undefined })
  expect(createLabel).toHaveBeenCalledWith({ name: 'Feature', color: undefined })
})
```

- [x] **Step 2: Run the create-label tests to verify they fail**

Run:

```bash
bun test tests/tools/label-tools.test.ts -t "already_exists|existing create behavior"
```

Expected: FAIL because `create_label` always calls `provider.createLabel()` and never returns a non-fatal status.

- [x] **Step 3: Create a small Kaneo label helper module**

Create `src/tools/kaneo-label-helpers.ts`. The actual file also exports `listWorkspaceLabels` (unconditional, no name filter), which is consumed by `add-task-label.ts` when resolving presence by `labelId`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Label, TaskLabel, TaskProvider } from '../providers/types.js'

export function isKaneoProvider(provider: Readonly<TaskProvider>): boolean {
  return provider.name === 'kaneo'
}

export function listWorkspaceLabels(provider: Readonly<TaskProvider>): Promise<Label[]> {
  if (provider.listLabels === undefined) return Promise.resolve([])
  return provider.listLabels()
}

export function listVisibleWorkspaceLabels(
  provider: Readonly<TaskProvider>,
  labelName: string | undefined,
): Promise<Label[]> {
  if (provider.getLabelByName !== undefined && labelName !== undefined) {
    return provider.getLabelByName(labelName)
  }
  return listWorkspaceLabels(provider)
}

export function listTaskLabels(provider: Readonly<TaskProvider>, taskId: string): Promise<TaskLabel[]> {
  if (!isKaneoProvider(provider) || provider.listTaskLabels === undefined) return Promise.resolve([])
  return provider.listTaskLabels(taskId)
}
```

- [x] **Step 4: Implement Kaneo-only `already_exists` in the tool**

Modify `src/tools/create-label.ts`:

```typescript
import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'
import { isKaneoProvider, listVisibleWorkspaceLabels } from './kaneo-label-helpers.js'

const log = logger.child({ scope: 'tool:create-label' })

export function makeCreateLabelTool(provider: TaskProvider): ToolSet[string] {
  return tool({
    description:
      'Create a new label in the workspace. In Kaneo, this creates a reusable workspace label and returns already_exists instead of creating a duplicate reusable label.',
    inputSchema: z.object({
      name: z.string().describe('Label name'),
      color: z.string().optional().describe("Hex color code (e.g. '#ff0000')"),
    }),
    execute: async ({ name, color }) => {
      try {
        if (isKaneoProvider(provider)) {
          const existing = (await listVisibleWorkspaceLabels(provider, name)).filter((label) => label.name === name)
          if (existing.length > 0) {
            return {
              status: 'already_exists' as const,
              labelName: name,
              existingLabelIds: existing.map((label) => label.id),
              message: `Reusable workspace label "${name}" already exists. No new label was created.`,
            }
          }
        }

        return await provider.createLabel!({ name, color })
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), name, tool: 'create_label' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
```

- [x] **Step 5: Run the create-label tests to verify they pass**

Run:

```bash
bun test tests/tools/label-tools.test.ts -t "already_exists|existing create behavior"
```

Expected: PASS. Kaneo returns `already_exists`; non-Kaneo providers retain the previous create path.

- [x] **Step 6: Commit the create-label changes**

Run:

```bash
git add src/tools/kaneo-label-helpers.ts src/tools/create-label.ts tests/tools/label-tools.test.ts
git commit -m "fix(tools): prevent duplicate Kaneo label creation"
```

---

## Task 3: Add Kaneo-only `already_present` / `already_absent` handling to task-label tools

**Files:**

- Modify: `src/tools/add-task-label.ts:1-80`
- Modify: `src/tools/remove-task-label.ts:1-80`
- Modify: `tests/tools/task-label-tools.test.ts:1-335`

- [x] **Step 1: Write the failing task-label tests**

Add these tests to `tests/tools/task-label-tools.test.ts`.

Inside `describe('makeAddTaskLabelTool', ...)`, add:

```typescript
test('returns already_present for Kaneo when task already has label by visible name', async () => {
  const addTaskLabel = mock(() => Promise.resolve({ taskId: 'task-1', labelId: 'workspace-label-1' }))
  const provider = createMockProvider({
    name: 'kaneo',
    listTaskLabels: mock(() => Promise.resolve([{ id: 'task-label-1', name: 'Feature', color: '#ff0000' }])),
    listLabels: mock(() => Promise.resolve([{ id: 'workspace-label-1', name: 'Feature', color: '#ff0000' }])),
    addTaskLabel,
  })

  const tool = makeAddTaskLabelTool(provider)
  assertToolExecute(tool)
  const result: unknown = await tool.execute(
    { taskId: 'task-1', labelName: 'Feature' },
    { toolCallId: '1', messages: [] },
  )

  expect(result).toMatchObject({
    status: 'already_present',
    taskId: 'task-1',
    labelName: 'Feature',
    taskLabelIds: ['task-label-1'],
  })
  expect(addTaskLabel).not.toHaveBeenCalled()
})

test('Kaneo still resolves reusable workspace label when task does not already have it', async () => {
  const addTaskLabel = mock(() => Promise.resolve({ taskId: 'task-1', labelId: 'workspace-label-1' }))
  const provider = createMockProvider({
    name: 'kaneo',
    listTaskLabels: mock(() => Promise.resolve([])),
    listLabels: mock(() => Promise.resolve([{ id: 'workspace-label-1', name: 'Feature', color: '#ff0000' }])),
    addTaskLabel,
  })

  const tool = makeAddTaskLabelTool(provider)
  assertToolExecute(tool)
  const result: unknown = await tool.execute(
    { taskId: 'task-1', labelName: 'Feature' },
    { toolCallId: '1', messages: [] },
  )

  assertTaskLabel(result)
  expect(result).toEqual({ taskId: 'task-1', labelId: 'workspace-label-1' })
  expect(addTaskLabel).toHaveBeenCalledWith('task-1', 'workspace-label-1')
})
```

Inside `describe('makeRemoveTaskLabelTool', ...)`, add:

```typescript
test('returns already_absent for Kaneo when task does not currently have label by visible name', async () => {
  const removeTaskLabel = mock(() => Promise.resolve({ taskId: 'task-1', labelId: 'task-label-1' }))
  const provider = createMockProvider({
    name: 'kaneo',
    listTaskLabels: mock(() => Promise.resolve([])),
    removeTaskLabel,
  })

  const tool = makeRemoveTaskLabelTool(provider)
  const result: unknown = await getToolExecutor(tool)(
    { taskId: 'task-1', labelName: 'Feature' },
    { toolCallId: '1', messages: [] },
  )

  expect(result).toMatchObject({
    status: 'already_absent',
    taskId: 'task-1',
    labelName: 'Feature',
  })
  expect(removeTaskLabel).not.toHaveBeenCalled()
})

test('Kaneo removes task label by task-scoped label id resolved from task labels', async () => {
  const removeTaskLabel = mock(() => Promise.resolve({ taskId: 'task-1', labelId: 'task-label-1' }))
  const provider = createMockProvider({
    name: 'kaneo',
    listTaskLabels: mock(() => Promise.resolve([{ id: 'task-label-1', name: 'Feature', color: '#ff0000' }])),
    removeTaskLabel,
  })

  const tool = makeRemoveTaskLabelTool(provider)
  assertToolExecute(tool)
  const result: unknown = await tool.execute(
    { taskId: 'task-1', labelName: 'Feature' },
    { toolCallId: '1', messages: [] },
  )

  assertTaskLabel(result)
  expect(result).toEqual({ taskId: 'task-1', labelId: 'task-label-1' })
  expect(removeTaskLabel).toHaveBeenCalledWith('task-1', 'task-label-1')
})
```

- [x] **Step 2: Run the task-label tests to verify they fail**

Run:

```bash
bun test tests/tools/task-label-tools.test.ts -t "already_present|already_absent|task does not already have it|task-scoped label id"
```

Expected: FAIL because both tools still use workspace label resolution and do not return structured non-fatal statuses.

- [x] **Step 3: Implement Kaneo task-label checks in `add_task_label`**

Modify `src/tools/add-task-label.ts`. The actual implementation extends the plan: `resolveKaneoAlreadyPresent` also handles the `labelId` case — when a caller passes a workspace `labelId`, it looks up the workspace label's name and checks whether any task label shares that name, returning `already_present` if so:

```typescript
import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'
import {
  isKaneoProvider,
  listTaskLabels,
  listVisibleWorkspaceLabels,
  listWorkspaceLabels,
} from './kaneo-label-helpers.js'

const log = logger.child({ scope: 'tool:add-task-label' })

type AlreadyPresentResult = {
  status: 'already_present'
  taskId: string
  labelName: string
  taskLabelIds: string[]
  message: string
}

const alreadyPresent = (taskId: string, labelName: string, taskLabelIds: string[]): AlreadyPresentResult => ({
  status: 'already_present',
  taskId,
  labelName,
  taskLabelIds,
  message: `Task already has label "${labelName}". No action was taken.`,
})

const resolveKaneoAlreadyPresent = async (
  provider: Readonly<TaskProvider>,
  taskId: string,
  labelId: string | undefined,
  labelName: string | undefined,
): Promise<AlreadyPresentResult | null> => {
  const taskMatches = await listTaskLabels(provider, taskId)

  if (labelName !== undefined) {
    const matchingByName = taskMatches.filter((label) => label.name === labelName)
    if (matchingByName.length > 0) {
      return alreadyPresent(
        taskId,
        labelName,
        matchingByName.map((label) => label.id),
      )
    }
    return null
  }

  if (labelId === undefined) return null

  const directMatch = taskMatches.find((label) => label.id === labelId)
  if (directMatch !== undefined) {
    return alreadyPresent(taskId, directMatch.name, [directMatch.id])
  }

  const workspaceLabel = (await listWorkspaceLabels(provider)).find((label) => label.id === labelId)
  if (workspaceLabel === undefined) return null

  const matchingByName = taskMatches.filter((label) => label.name === workspaceLabel.name)
  if (matchingByName.length === 0) return null

  return alreadyPresent(
    taskId,
    workspaceLabel.name,
    matchingByName.map((label) => label.id),
  )
}

const resolveWorkspaceLabelId = async (
  provider: Readonly<TaskProvider>,
  labelId: string | undefined,
  labelName: string | undefined,
): Promise<string> => {
  if (labelId !== undefined) return labelId
  if (labelName === undefined) throw new Error('Provide exactly one of labelId or labelName')
  const labels = await listVisibleWorkspaceLabels(provider, labelName)
  const matches = labels.filter((label) => label.name === labelName)
  if (matches.length === 0) throw new Error(`Label not found: ${labelName}`)
  if (matches.length > 1) throw new Error(`Multiple labels found: ${labelName}`)
  return matches[0]!.id
}

export function makeAddTaskLabelTool(provider: Readonly<TaskProvider>): ToolSet[string] {
  return tool({
    description:
      'Add a label to a task. For Kaneo, labelName resolves against reusable workspace labels and returns already_present when the task already has that visible label.',
    inputSchema: labelTargetSchema,
    execute: async ({ taskId, labelId, labelName }) => {
      try {
        if (isKaneoProvider(provider)) {
          const existing = await resolveKaneoAlreadyPresent(provider, taskId, labelId, labelName)
          if (existing !== null) return existing
        }
        const resolvedLabelId = await resolveWorkspaceLabelId(provider, labelId, labelName)
        return await provider.addTaskLabel!(taskId, resolvedLabelId)
      } catch (error) {
        log.error(
          {
            error: error instanceof Error ? error.message : String(error),
            taskId,
            labelId,
            labelName,
            tool: 'add_task_label',
          },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
```

- [x] **Step 4: Implement Kaneo task-label checks in `remove_task_label`**

Modify `src/tools/remove-task-label.ts`. The actual implementation uses two `AlreadyAbsent` variants (by-name and by-id) and a `resolveKaneoTaskLabelIdById` helper that resolves workspace label names when a caller passes a workspace `labelId` rather than a task-scoped label id:

```typescript
import { logger } from '../logger.js'
import type { TaskLabel, TaskProvider } from '../providers/types.js'
import { isKaneoProvider, listTaskLabels, listVisibleWorkspaceLabels } from './kaneo-label-helpers.js'

const log = logger.child({ scope: 'tool:remove-task-label' })

type AlreadyAbsentByNameResult = { status: 'already_absent'; taskId: string; labelName: string; message: string }
type AlreadyAbsentByIdResult = { status: 'already_absent'; taskId: string; labelId: string; message: string }
type AlreadyAbsentResult = AlreadyAbsentByNameResult | AlreadyAbsentByIdResult

const resolveKaneoTaskLabelIdById = async (
  provider: Readonly<TaskProvider>,
  taskId: string,
  labelId: string,
  taskLabels: readonly TaskLabel[],
): Promise<string | AlreadyAbsentByIdResult> => {
  const direct = taskLabels.find((label) => label.id === labelId)
  if (direct !== undefined) return direct.id

  const workspaceLabels = await listVisibleWorkspaceLabels(provider, labelId)
  const workspaceLabel = workspaceLabels.find((label) => label.id === labelId)
  if (workspaceLabel === undefined) {
    return {
      status: 'already_absent',
      taskId,
      labelId,
      message: `Task does not currently have label id "${labelId}". No action was taken.`,
    }
  }
  const taskMatches = taskLabels.filter((label) => label.name === workspaceLabel.name)
  if (taskMatches.length === 0) {
    return {
      status: 'already_absent',
      taskId,
      labelId,
      message: `Task does not currently have label id "${labelId}". No action was taken.`,
    }
  }
  if (taskMatches.length > 1) throw new Error(`Multiple task labels found: ${workspaceLabel.name}`)
  return taskMatches[0]!.id
}

const resolveKaneoTaskLabelId = async (
  provider: Readonly<TaskProvider>,
  taskId: string,
  labelId: string | undefined,
  labelName: string | undefined,
): Promise<string | AlreadyAbsentResult> => {
  const taskLabels = await listTaskLabels(provider, taskId)

  if (labelId !== undefined) return resolveKaneoTaskLabelIdById(provider, taskId, labelId, taskLabels)
  if (labelName === undefined) throw new Error('Provide exactly one of labelId or labelName')

  const matches = taskLabels.filter((label) => label.name === labelName)
  if (matches.length === 0) {
    return {
      status: 'already_absent',
      taskId,
      labelName,
      message: `Task does not currently have label "${labelName}". No action was taken.`,
    }
  }
  if (matches.length > 1) throw new Error(`Multiple task labels found: ${labelName}`)
  return matches[0]!.id
}

const resolveTaskLabelId = (
  provider: Readonly<TaskProvider>,
  taskId: string,
  labelId: string | undefined,
  labelName: string | undefined,
): Promise<string | AlreadyAbsentResult> => {
  if (isKaneoProvider(provider)) return resolveKaneoTaskLabelId(provider, taskId, labelId, labelName)
  return resolveWorkspaceLabelId(provider, labelId, labelName) as Promise<string | AlreadyAbsentResult>
}

export function makeRemoveTaskLabelTool(provider: Readonly<TaskProvider>): ToolSet[string] {
  return tool({
    description:
      'Remove a label from a task. For Kaneo, labelName resolves against labels currently attached to the task and returns already_absent when the task does not have that label.',
    inputSchema: labelTargetSchema,
    execute: async ({ taskId, labelId, labelName }) => {
      try {
        const resolved = await resolveTaskLabelId(provider, taskId, labelId, labelName)
        if (typeof resolved === 'object' && 'status' in resolved) return resolved
        return await provider.removeTaskLabel!(taskId, resolved)
      } catch (error) {
        log.error(
          {
            error: error instanceof Error ? error.message : String(error),
            taskId,
            labelId,
            labelName,
            tool: 'remove_task_label',
          },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
```

- [x] **Step 5: Run the task-label tests to verify they pass**

Run:

```bash
bun test tests/tools/task-label-tools.test.ts
```

Expected: PASS, including the new Kaneo-only non-fatal statuses and the existing non-Kaneo behavior.

- [x] **Step 6: Commit the task-label tool changes**

Run:

```bash
git add src/tools/add-task-label.ts src/tools/remove-task-label.ts tests/tools/task-label-tools.test.ts
git commit -m "fix(tools): add Kaneo task-label status handling"
```

---

## Task 4: Add safe Kaneo label deduplication SQL scripts

> **Status: Intentionally dropped.** The scripts were initially created (commit `b657ef4b chore(sql): add Kaneo label dedup scripts`) and then explicitly removed (commit `0f4d691f chore(sql): drop uncommitted Kaneo dedup scripts`). They are not present in the repository and are not expected to be re-added as part of this plan. If deduplication is needed in the future, this task can serve as the reference for the query approach.

**Files (not present):**

- `scripts/sql/kaneo-label-dedup-preview.sql` — dropped
- `scripts/sql/kaneo-label-dedup-apply.sql` — dropped

**Preview query approach (for reference):**

Duplicate reusable workspace labels: group by `(workspace_id, name)` where `task_id IS NULL`, `HAVING COUNT(*) > 1`.
Duplicate same-name task labels: group by `(task_id, name)` where `task_id IS NOT NULL`, `HAVING COUNT(*) > 1`.

**Apply approach (for reference):**

`ROW_NUMBER() OVER (PARTITION BY workspace_id, name ORDER BY id)` keeps the lexicographically smallest id; all `rn > 1` rows are deleted in a `BEGIN…COMMIT` block.

---

## Task 5: Final verification sweep

**Files:**

- Modify: none
- Verify: `src/providers/types.ts`
- Verify: `src/providers/kaneo/label-resource.ts`
- Verify: `src/providers/kaneo/list-task-labels.ts`
- Verify: `src/providers/kaneo/operations/labels.ts`
- Verify: `src/providers/kaneo/index.ts`
- Verify: `src/tools/kaneo-label-helpers.ts`
- Verify: `src/tools/create-label.ts`
- Verify: `src/tools/add-task-label.ts`
- Verify: `src/tools/remove-task-label.ts`
- Verify: `tests/providers/kaneo/label-resource.test.ts`
- Verify: `tests/providers/kaneo/index.test.ts`
- Verify: `tests/tools/label-tools.test.ts`
- Verify: `tests/tools/task-label-tools.test.ts`
- Verify: `scripts/sql/kaneo-label-dedup-preview.sql`
- Verify: `scripts/sql/kaneo-label-dedup-apply.sql`

- [x] **Step 1: Run the full targeted test suite**

Run:

```bash
bun test tests/providers/kaneo/label-resource.test.ts tests/providers/kaneo/index.test.ts tests/tools/label-tools.test.ts tests/tools/task-label-tools.test.ts
```

Expected: PASS.

- [x] **Step 2: Run typecheck to catch provider contract drift**

Run:

```bash
bun typecheck
```

Expected: PASS. In particular, the new optional `listTaskLabels()` method should not break existing providers.

- [x] **Step 3: Run the stricter lint pass on touched implementation files**

Run:

```bash
bun lint:agent-strict -- src/providers/types.ts src/providers/kaneo/label-resource.ts src/providers/kaneo/list-task-labels.ts src/providers/kaneo/operations/labels.ts src/providers/kaneo/index.ts src/tools/kaneo-label-helpers.ts src/tools/create-label.ts src/tools/add-task-label.ts src/tools/remove-task-label.ts
```

Expected: PASS.

- [x] **Step 4: Commit the verification checkpoint**

Run:

```bash
git add -A
git commit -m "test: verify Kaneo label semantics changes"
```

Expected: either a small verification-only commit or `nothing to commit` if all previous task commits captured the final tree.

---

## Task 6: Standalone test files for new source modules and updated tools

> Added retroactively during plan sync (2026-05-23). These files were created alongside Tasks 1–3 to provide dedicated test coverage for each new source module; they were not included in the original plan file.

**Files:**

- Create: `tests/providers/kaneo/list-task-labels.test.ts`
- Create: `tests/providers/kaneo/operations/labels.test.ts`
- Create: `tests/tools/add-task-label.test.ts`
- Create: `tests/tools/create-label.test.ts`
- Create: `tests/tools/kaneo-label-helpers.test.ts`
- Create: `tests/tools/remove-task-label.test.ts`

- [x] **Step 1: Create standalone test files for each new source module**

Six test files were created:

- `tests/providers/kaneo/list-task-labels.test.ts` — covers `listTaskLabels()` in `src/providers/kaneo/list-task-labels.ts`
- `tests/providers/kaneo/operations/labels.test.ts` — covers `kaneoListLabels` / `kaneoListTaskLabels` filtering in `src/providers/kaneo/operations/labels.ts`
- `tests/tools/add-task-label.test.ts` — standalone tests for `makeAddTaskLabelTool` beyond what `task-label-tools.test.ts` already covers
- `tests/tools/create-label.test.ts` — standalone tests for `makeCreateLabelTool`
- `tests/tools/kaneo-label-helpers.test.ts` — unit tests for `isKaneoProvider`, `listWorkspaceLabels`, `listVisibleWorkspaceLabels`, `listTaskLabels`
- `tests/tools/remove-task-label.test.ts` — standalone tests for `makeRemoveTaskLabelTool`

- [x] **Step 2: Verify all tests pass**

Run:

```bash
bun test tests/providers/kaneo/list-task-labels.test.ts tests/providers/kaneo/operations/labels.test.ts tests/tools/add-task-label.test.ts tests/tools/create-label.test.ts tests/tools/kaneo-label-helpers.test.ts tests/tools/remove-task-label.test.ts
```

Expected: PASS.

---

## Self-review notes

- **Spec coverage:** The plan covers reusable workspace label filtering (Task 1), Kaneo-only `already_exists` (Task 2), Kaneo-only `already_present` / `already_absent` (Task 3), Task 4 SQL scripts (intentionally dropped — reference approach preserved in the task body), and standalone test files (Task 6, added retroactively).
- **Placeholder scan:** No `TODO`, `TBD`, or “similar to above” placeholders remain; every completed task includes concrete code and commands.
- **Type consistency:** `listTaskLabels(taskId)` is introduced in the provider contract, mocked in `tests/tools/mock-provider.ts`, implemented only for Kaneo, and consumed by Kaneo-only tool logic via `isKaneoProvider()`.

---

## Drift Log

| Date       | Category             | Item                                                                                         | Decision                                                                                          |
| ---------- | -------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 2026-05-23 | In-plan, divergent   | `operations/labels.ts` filter: inline `=== null` → `isReusableWorkspaceLabel` helper         | Code wins — updated Task 1 Step 4 snippet to show helper that also accepts `taskId === undefined` |
| 2026-05-23 | In-plan, divergent   | `kaneo-label-helpers.ts`: extra `listWorkspaceLabels` export not in plan                     | Code wins — updated Task 2 Step 3 snippet to include the fourth export                            |
| 2026-05-23 | In-plan, divergent   | `add-task-label.ts`: Kaneo check extended to `labelId` case via `resolveKaneoAlreadyPresent` | Code wins — updated Task 3 Step 3 snippet to show full function                                   |
| 2026-05-23 | In-plan, divergent   | `remove-task-label.ts`: two `AlreadyAbsent` types; `resolveKaneoTaskLabelIdById` added       | Code wins — updated Task 3 Step 4 snippet to show two-type shape                                  |
| 2026-05-23 | In-plan, missing     | Task 4 SQL scripts: added then dropped (`0f4d691f`)                                          | Marked Task 4 as intentionally dropped; reference approach preserved in task body                 |
| 2026-05-23 | Out-of-plan, on-goal | 6 new standalone test files for new source modules                                           | Added as Task 6 with all steps marked `[x]`                                                       |
