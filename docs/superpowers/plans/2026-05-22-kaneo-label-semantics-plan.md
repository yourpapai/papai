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

- [ ] **Step 1: Write the failing provider tests**

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

- [ ] **Step 2: Run the provider tests to verify they fail**

Run:

```bash
bun test tests/providers/kaneo/label-resource.test.ts tests/providers/kaneo/index.test.ts
```

Expected: FAIL because `LabelResource.listForTask()` and `KaneoProvider.listTaskLabels()` do not exist, and `listLabels()` still returns task-bound rows.

- [ ] **Step 3: Add the provider contract and Kaneo resource methods**

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

- [ ] **Step 4: Filter Kaneo workspace labels and expose task labels from the provider**

Modify `src/providers/kaneo/operations/labels.ts`:

```typescript
import type { Label, TaskLabel } from '../../types.js'
import { addTaskLabel } from '../add-task-label.js'
import type { KaneoConfig } from '../client.js'
import { createLabel } from '../create-label.js'
import { listLabels } from '../list-labels.js'
import { listTaskLabels } from '../list-task-labels.js'
import { mapLabel } from '../mappers.js'
import { removeLabel } from '../remove-label.js'
import { removeTaskLabel } from '../remove-task-label.js'
import { updateLabel } from '../update-label.js'

const mapTaskLabel = (label: { id: string; name: string; color?: string }): TaskLabel => ({
  id: label.id,
  name: label.name,
  color: label.color,
})

export async function kaneoListLabels(config: KaneoConfig, workspaceId: string): Promise<Label[]> {
  const results = await listLabels({ config, workspaceId })
  return results.filter((label) => label.taskId === null).map(mapLabel)
}

export async function kaneoListTaskLabels(config: KaneoConfig, taskId: string): Promise<TaskLabel[]> {
  const results = await listTaskLabels({ config, taskId })
  return results.map(mapTaskLabel)
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

- [ ] **Step 5: Run the provider tests to verify they pass**

Run:

```bash
bun test tests/providers/kaneo/label-resource.test.ts tests/providers/kaneo/index.test.ts
```

Expected: PASS, including the new task-label endpoint coverage and the reusable-label filtering behavior.

- [ ] **Step 6: Commit the provider changes**

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

- [ ] **Step 1: Write the failing create-label tests**

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

- [ ] **Step 2: Run the create-label tests to verify they fail**

Run:

```bash
bun test tests/tools/label-tools.test.ts -t "already_exists|existing create behavior"
```

Expected: FAIL because `create_label` always calls `provider.createLabel()` and never returns a non-fatal status.

- [ ] **Step 3: Create a small Kaneo label helper module**

Create `src/tools/kaneo-label-helpers.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Label, TaskLabel, TaskProvider } from '../providers/types.js'

export function isKaneoProvider(provider: Readonly<TaskProvider>): boolean {
  return provider.name === 'kaneo'
}

export async function listVisibleWorkspaceLabels(
  provider: Readonly<TaskProvider>,
  labelName?: string,
): Promise<Label[]> {
  if (provider.getLabelByName !== undefined && labelName !== undefined) {
    return await provider.getLabelByName(labelName)
  }
  return (await provider.listLabels?.()) ?? []
}

export async function listTaskLabels(provider: Readonly<TaskProvider>, taskId: string): Promise<TaskLabel[]> {
  if (!isKaneoProvider(provider) || provider.listTaskLabels === undefined) return []
  return await provider.listTaskLabels(taskId)
}
```

- [ ] **Step 4: Implement Kaneo-only `already_exists` in the tool**

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

- [ ] **Step 5: Run the create-label tests to verify they pass**

Run:

```bash
bun test tests/tools/label-tools.test.ts -t "already_exists|existing create behavior"
```

Expected: PASS. Kaneo returns `already_exists`; non-Kaneo providers retain the previous create path.

- [ ] **Step 6: Commit the create-label changes**

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

- [ ] **Step 1: Write the failing task-label tests**

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

- [ ] **Step 2: Run the task-label tests to verify they fail**

Run:

```bash
bun test tests/tools/task-label-tools.test.ts -t "already_present|already_absent|task does not already have it|task-scoped label id"
```

Expected: FAIL because both tools still use workspace label resolution and do not return structured non-fatal statuses.

- [ ] **Step 3: Implement Kaneo task-label checks in `add_task_label`**

Modify `src/tools/add-task-label.ts`:

```typescript
import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'
import { isKaneoProvider, listTaskLabels, listVisibleWorkspaceLabels } from './kaneo-label-helpers.js'

const log = logger.child({ scope: 'tool:add-task-label' })

const resolveWorkspaceLabelId = async (
  provider: Readonly<TaskProvider>,
  labelId: string | undefined,
  labelName: string | undefined,
): Promise<string> => {
  if (labelId !== undefined) return labelId
  if (labelName === undefined) {
    throw new Error('Provide exactly one of labelId or labelName')
  }
  const labels = await listVisibleWorkspaceLabels(provider, labelName)
  const matches = labels.filter((label) => label.name === labelName)
  if (matches.length === 0) {
    throw new Error(`Label not found: ${labelName}`)
  }
  if (matches.length > 1) {
    throw new Error(`Multiple labels found: ${labelName}`)
  }
  return matches[0]!.id
}

export function makeAddTaskLabelTool(provider: Readonly<TaskProvider>): ToolSet[string] {
  return tool({
    description:
      'Add a label to a task. For Kaneo, labelName resolves against reusable workspace labels and returns already_present when the task already has that visible label.',
    inputSchema: labelTargetSchema,
    execute: async ({ taskId, labelId, labelName }) => {
      try {
        if (isKaneoProvider(provider) && labelName !== undefined) {
          const taskMatches = (await listTaskLabels(provider, taskId)).filter((label) => label.name === labelName)
          if (taskMatches.length > 0) {
            return {
              status: 'already_present' as const,
              taskId,
              labelName,
              taskLabelIds: taskMatches.map((label) => label.id),
              message: `Task already has label "${labelName}". No action was taken.`,
            }
          }
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

- [ ] **Step 4: Implement Kaneo task-label checks in `remove_task_label`**

Modify `src/tools/remove-task-label.ts`:

```typescript
import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'
import { isKaneoProvider, listTaskLabels, listVisibleWorkspaceLabels } from './kaneo-label-helpers.js'

const log = logger.child({ scope: 'tool:remove-task-label' })

const resolveTaskLabelId = async (
  provider: Readonly<TaskProvider>,
  taskId: string,
  labelId: string | undefined,
  labelName: string | undefined,
): Promise<string | { status: 'already_absent'; taskId: string; labelName: string; message: string }> => {
  if (isKaneoProvider(provider)) {
    const taskLabels = await listTaskLabels(provider, taskId)

    if (labelId !== undefined) {
      const direct = taskLabels.find((label) => label.id === labelId)
      if (direct !== undefined) return direct.id
      return {
        status: 'already_absent',
        taskId,
        labelName: labelId,
        message: `Task does not currently have label id "${labelId}". No action was taken.`,
      }
    }

    if (labelName === undefined) {
      throw new Error('Provide exactly one of labelId or labelName')
    }

    const matches = taskLabels.filter((label) => label.name === labelName)
    if (matches.length === 0) {
      return {
        status: 'already_absent',
        taskId,
        labelName,
        message: `Task does not currently have label "${labelName}". No action was taken.`,
      }
    }
    if (matches.length > 1) {
      throw new Error(`Multiple task labels found: ${labelName}`)
    }
    return matches[0]!.id
  }

  if (labelId !== undefined) return labelId
  if (labelName === undefined) {
    throw new Error('Provide exactly one of labelId or labelName')
  }
  const labels = await listVisibleWorkspaceLabels(provider, labelName)
  const matches = labels.filter((label) => label.name === labelName)
  if (matches.length === 0) {
    throw new Error(`Label not found: ${labelName}`)
  }
  if (matches.length > 1) {
    throw new Error(`Multiple labels found: ${labelName}`)
  }
  return matches[0]!.id
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

- [ ] **Step 5: Run the task-label tests to verify they pass**

Run:

```bash
bun test tests/tools/task-label-tools.test.ts
```

Expected: PASS, including the new Kaneo-only non-fatal statuses and the existing non-Kaneo behavior.

- [ ] **Step 6: Commit the task-label tool changes**

Run:

```bash
git add src/tools/add-task-label.ts src/tools/remove-task-label.ts tests/tools/task-label-tools.test.ts
git commit -m "fix(tools): add Kaneo task-label status handling"
```

---

## Task 4: Add safe Kaneo label deduplication SQL scripts

**Files:**

- Create: `scripts/sql/kaneo-label-dedup-preview.sql`
- Create: `scripts/sql/kaneo-label-dedup-apply.sql`

- [ ] **Step 1: Write the SQL preview script**

Create `scripts/sql/kaneo-label-dedup-preview.sql`:

```sql
-- Preview duplicate reusable workspace labels
SELECT
  l.workspace_id,
  l.name,
  COUNT(*) AS duplicate_count,
  ARRAY_AGG(l.id ORDER BY l.id) AS label_ids
FROM "label" l
WHERE l.workspace_id IS NOT NULL
  AND l.task_id IS NULL
GROUP BY l.workspace_id, l.name
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, l.workspace_id, l.name;

-- Preview duplicate same-name labels on the same task
SELECT
  l.task_id,
  l.name,
  COUNT(*) AS duplicate_count,
  ARRAY_AGG(l.id ORDER BY l.id) AS label_ids
FROM "label" l
WHERE l.task_id IS NOT NULL
GROUP BY l.task_id, l.name
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, l.task_id, l.name;
```

- [ ] **Step 2: Write the safe consolidation script**

Create `scripts/sql/kaneo-label-dedup-apply.sql`:

```sql
BEGIN;

-- Remove duplicate reusable workspace labels, keeping the lexicographically smallest id
WITH ranked_workspace AS (
  SELECT
    l.id,
    ROW_NUMBER() OVER (
      PARTITION BY l.workspace_id, l.name
      ORDER BY l.id
    ) AS rn
  FROM "label" l
  WHERE l.workspace_id IS NOT NULL
    AND l.task_id IS NULL
),
delete_workspace AS (
  SELECT id
  FROM ranked_workspace
  WHERE rn > 1
)
DELETE FROM "label" l
USING delete_workspace d
WHERE l.id = d.id;

-- Remove duplicate same-name labels on the same task, keeping the lexicographically smallest id
WITH ranked_task AS (
  SELECT
    l.id,
    ROW_NUMBER() OVER (
      PARTITION BY l.task_id, l.name
      ORDER BY l.id
    ) AS rn
  FROM "label" l
  WHERE l.task_id IS NOT NULL
),
delete_task AS (
  SELECT id
  FROM ranked_task
  WHERE rn > 1
)
DELETE FROM "label" l
USING delete_task d
WHERE l.id = d.id;

COMMIT;
```

- [ ] **Step 3: Run the preview script and verify it only reports safe targets**

Run:

```bash
docker compose exec -T kaneo-postgres sh -lc 'psql -U "${POSTGRES_USER:-kaneo}" -d "${POSTGRES_DB:-kaneo}" -v ON_ERROR_STOP=1 -At' < scripts/sql/kaneo-label-dedup-preview.sql
```

Expected: zero or more preview rows. Rows should only represent duplicate reusable workspace labels or duplicate same-name labels on the same task. Cross-task same-name rows such as your current `Feature` data should not appear in the second query unless the same task has the duplicate more than once.

- [ ] **Step 4: Run the apply script in a test/staging environment first**

Run:

```bash
docker compose exec -T kaneo-postgres sh -lc 'psql -U "${POSTGRES_USER:-kaneo}" -d "${POSTGRES_DB:-kaneo}" -v ON_ERROR_STOP=1' < scripts/sql/kaneo-label-dedup-apply.sql
```

Expected: `BEGIN`, one or two `DELETE <n>` lines, then `COMMIT`. If this is production data, take a database backup before running it outside staging.

- [ ] **Step 5: Re-run the preview script to verify cleanup completed**

Run:

```bash
docker compose exec -T kaneo-postgres sh -lc 'psql -U "${POSTGRES_USER:-kaneo}" -d "${POSTGRES_DB:-kaneo}" -v ON_ERROR_STOP=1 -At' < scripts/sql/kaneo-label-dedup-preview.sql
```

Expected: no rows for duplicate reusable workspace labels and no rows for duplicate same-name labels on the same task.

- [ ] **Step 6: Commit the SQL scripts**

Run:

```bash
git add scripts/sql/kaneo-label-dedup-preview.sql scripts/sql/kaneo-label-dedup-apply.sql
git commit -m "chore(sql): add Kaneo label dedup scripts"
```

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

- [ ] **Step 1: Run the full targeted test suite**

Run:

```bash
bun test tests/providers/kaneo/label-resource.test.ts tests/providers/kaneo/index.test.ts tests/tools/label-tools.test.ts tests/tools/task-label-tools.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck to catch provider contract drift**

Run:

```bash
bun typecheck
```

Expected: PASS. In particular, the new optional `listTaskLabels()` method should not break existing providers.

- [ ] **Step 3: Run the stricter lint pass on touched implementation files**

Run:

```bash
bun lint:agent-strict -- src/providers/types.ts src/providers/kaneo/label-resource.ts src/providers/kaneo/list-task-labels.ts src/providers/kaneo/operations/labels.ts src/providers/kaneo/index.ts src/tools/kaneo-label-helpers.ts src/tools/create-label.ts src/tools/add-task-label.ts src/tools/remove-task-label.ts
```

Expected: PASS.

- [ ] **Step 4: Commit the verification checkpoint**

Run:

```bash
git add -A
git commit -m "test: verify Kaneo label semantics changes"
```

Expected: either a small verification-only commit or `nothing to commit` if all previous task commits captured the final tree.

---

## Self-review notes

- **Spec coverage:** The plan covers reusable workspace label filtering (Task 1), Kaneo-only `already_exists` (Task 2), Kaneo-only `already_present` / `already_absent` (Task 3), and safe SQL consolidation scripts (Task 4).
- **Placeholder scan:** No `TODO`, `TBD`, or “similar to above” placeholders remain; every task includes concrete code and commands.
- **Type consistency:** `listTaskLabels(taskId)` is introduced in the provider contract, mocked in `tests/tools/mock-provider.ts`, implemented only for Kaneo, and consumed by Kaneo-only tool logic via `isKaneoProvider()`.
