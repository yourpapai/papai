<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# YouTrack Gap Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the missing YouTrack features already implemented in the provider, make the shared task tools honest about custom fields, and add one YouTrack-native command escape hatch for advanced workflows.

**Architecture:** Keep provider-specific HTTP details in `src/providers/youtrack/operations/` and keep the LLM-facing contract in one-tool-per-file wrappers under `src/tools/`. Close the biggest gap first by exposing the existing phase-five provider methods, then tighten the `Task`/`update_task` contract around read-only and write-safe custom fields, and finally add a single provider-specific `apply_youtrack_command` tool for workflows that do not fit the normalized CRUD surface.

**Tech Stack:** Bun, TypeScript, Zod v4, Vercel AI SDK tool factory, Bun test runner, YouTrack REST API.

---

## Worktree And Reading Order

Use a dedicated worktree before starting implementation.

Run:

```bash
git worktree add ../papai-youtrack-gap-closure -b feat/youtrack-gap-closure
```

Then read these files in this order before changing code:

1. `src/tools/tools-builder.ts`
2. `src/providers/task-provider-phase-five.ts`
3. `src/providers/types.ts`
4. `src/providers/youtrack/phase-five-provider.ts`
5. `src/providers/youtrack/task-helpers.ts`
6. `src/providers/youtrack/operations/agiles.ts`
7. `src/providers/youtrack/operations/activities.ts`
8. `src/providers/youtrack/operations/saved-queries.ts`
9. `tests/tools/tools-builder.test.ts`
10. `tests/providers/youtrack/tools-integration.test.ts`

## File Structure

**Provider contract and normalized types**

- `src/providers/domain-types.ts`
  Purpose: hold normalized `Task`, `Activity`, `Agile`, `Sprint`, `SavedQuery`, and new command/custom-field shapes.
- `src/providers/types.ts`
  Purpose: capability strings and the `TaskProvider` interface used by all tool factories.
- `src/providers/task-provider-phase-five.ts`
  Purpose: optional advanced provider surfaces already implemented for YouTrack and still not exposed.

**YouTrack provider internals**

- `src/providers/youtrack/constants.ts`
  Purpose: YouTrack capability set and request field selections.
- `src/providers/youtrack/mappers.ts`
  Purpose: turn raw YouTrack issue payloads into normalized task shapes, including read-only custom fields.
- `src/providers/youtrack/task-helpers.ts`
  Purpose: shared helper logic for due dates and write-safe custom-field payload construction.
- `src/providers/youtrack/operations/commands.ts`
  Purpose: new low-level YouTrack `/api/commands` wrapper.
- `src/providers/youtrack/index.ts`
  Purpose: wire new provider method(s) into the concrete YouTrack provider class.
- `src/providers/youtrack/prompt-addendum.ts`
  Purpose: teach the model when to prefer normalized tools vs the provider-specific command tool.

**LLM-facing tools**

- `src/tools/list-agiles.ts`
  Purpose: list agile boards.
- `src/tools/list-sprints.ts`
  Purpose: list sprints for an agile board.
- `src/tools/create-sprint.ts`
  Purpose: create a sprint.
- `src/tools/update-sprint.ts`
  Purpose: update a sprint.
- `src/tools/assign-task-to-sprint.ts`
  Purpose: attach an issue to a sprint.
- `src/tools/get-task-history.ts`
  Purpose: expose issue activity history.
- `src/tools/list-saved-queries.ts`
  Purpose: list saved queries.
- `src/tools/run-saved-query.ts`
  Purpose: run one saved query and return normalized search results.
- `src/tools/apply-youtrack-command.ts`
  Purpose: provider-specific escape hatch for YouTrack command syntax.
- `src/tools/update-task.ts`
  Purpose: extend shared task update contract with write-safe custom fields.
- `src/tools/get-task.ts`
  Purpose: return normalized read-only custom fields to make updates explainable.
- `src/tools/tools-builder.ts`
  Purpose: actual exposed tool surface and capability gating.

**Tests to change first**

- `tests/tools/agile-tools.test.ts`
- `tests/tools/task-history-tools.test.ts`
- `tests/tools/saved-query-tools.test.ts`
- `tests/tools/youtrack-command.test.ts`
- `tests/tools/update-task.test.ts`
- `tests/tools/get-task.test.ts`
- `tests/tools/tools-builder.test.ts`
- `tests/tools/index.test.ts`
- `tests/providers/youtrack/tools-integration.test.ts`
- `tests/providers/youtrack/operations/commands.test.ts`
- `tests/providers/youtrack/operations/tasks.test.ts`

## Scope Guardrails

- Do not add a generic arbitrary-field editor to the shared provider contract.
- Do not invent multi-value field support in this pass.
- Do not rewrite provider internals outside the files listed above.
- Do not add phase-five tools for providers that do not already advertise the relevant capability.
- Use `apply_youtrack_command` for advanced YouTrack-native flows instead of pushing provider-specific semantics into every shared tool.

---

### Task 1: Expose Agile And Sprint Tools

**Files:**

- Create: `src/tools/list-agiles.ts`
- Create: `src/tools/list-sprints.ts`
- Create: `src/tools/create-sprint.ts`
- Create: `src/tools/update-sprint.ts`
- Create: `src/tools/assign-task-to-sprint.ts`
- Modify: `src/providers/types.ts`
- Modify: `src/providers/youtrack/constants.ts`
- Modify: `src/tools/tools-builder.ts`
- Modify: `tests/tools/mock-provider.ts`
- Create: `tests/tools/agile-tools.test.ts`
- Modify: `tests/tools/tools-builder.test.ts`
- Modify: `tests/tools/index.test.ts`
- Modify: `tests/providers/youtrack/tools-integration.test.ts`

- [ ] **Step 1: Write the failing tool tests**

Create `tests/tools/agile-tools.test.ts` with this content:

```ts
import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { makeAssignTaskToSprintTool } from '../../src/tools/assign-task-to-sprint.js'
import { makeCreateSprintTool } from '../../src/tools/create-sprint.js'
import { makeListAgilesTool } from '../../src/tools/list-agiles.js'
import { makeListSprintsTool } from '../../src/tools/list-sprints.js'
import { makeUpdateSprintTool } from '../../src/tools/update-sprint.js'
import { getToolExecutor, mockLogger, schemaValidates } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

describe('Agile tools', () => {
  beforeEach(() => {
    mockLogger()
    mock.restore()
  })

  test('list_agiles returns provider agiles', async () => {
    const listAgiles = mock(() => Promise.resolve([{ id: 'agile-1', name: 'Team Board' }]))
    const result = await getToolExecutor(makeListAgilesTool(createMockProvider({ listAgiles })))({})
    expect(result).toEqual([{ id: 'agile-1', name: 'Team Board' }])
    expect(listAgiles).toHaveBeenCalledTimes(1)
  })

  test('list_sprints requires agileId', () => {
    expect(schemaValidates(makeListSprintsTool(createMockProvider()), {})).toBe(false)
    expect(schemaValidates(makeListSprintsTool(createMockProvider()), { agileId: 'agile-1' })).toBe(true)
  })

  test('create_sprint forwards the normalized payload', async () => {
    const createSprint = mock((agileId: string, params: { name: string }) =>
      Promise.resolve({ id: 'sprint-1', agileId, name: params.name, archived: false }),
    )
    const result = await getToolExecutor(makeCreateSprintTool(createMockProvider({ createSprint })))({
      agileId: 'agile-1',
      name: 'Sprint 24',
      goal: 'Ship commands',
      start: '2026-04-15T00:00:00.000Z',
      finish: '2026-04-22T00:00:00.000Z',
    })
    expect(result).toEqual({ id: 'sprint-1', agileId: 'agile-1', name: 'Sprint 24', archived: false })
    expect(createSprint).toHaveBeenCalledWith('agile-1', {
      name: 'Sprint 24',
      goal: 'Ship commands',
      start: '2026-04-15T00:00:00.000Z',
      finish: '2026-04-22T00:00:00.000Z',
      previousSprintId: undefined,
      isDefault: undefined,
    })
  })

  test('update_sprint requires agileId and sprintId', () => {
    const tool = makeUpdateSprintTool(createMockProvider())
    expect(schemaValidates(tool, { agileId: 'agile-1' })).toBe(false)
    expect(schemaValidates(tool, { sprintId: 'sprint-1' })).toBe(false)
    expect(schemaValidates(tool, { agileId: 'agile-1', sprintId: 'sprint-1', archived: true })).toBe(true)
  })

  test('assign_task_to_sprint forwards task and sprint IDs', async () => {
    const assignTaskToSprint = mock((taskId: string, sprintId: string) => Promise.resolve({ taskId, sprintId }))
    const result = await getToolExecutor(makeAssignTaskToSprintTool(createMockProvider({ assignTaskToSprint })))({
      taskId: 'TEST-1',
      sprintId: 'sprint-3',
    })
    expect(result).toEqual({ taskId: 'TEST-1', sprintId: 'sprint-3' })
    expect(assignTaskToSprint).toHaveBeenCalledWith('TEST-1', 'sprint-3')
  })
})
```

Append these assertions to `tests/tools/tools-builder.test.ts` inside `describe('buildTools', ...)`:

```ts
it('should expose agile and sprint tools when phase-five capabilities are present', () => {
  const provider = createMockProvider()
  const tools = buildTools(provider, 'user-123', 'user-123', 'normal')

  expect(tools).toHaveProperty('list_agiles')
  expect(tools).toHaveProperty('list_sprints')
  expect(tools).toHaveProperty('create_sprint')
  expect(tools).toHaveProperty('update_sprint')
  expect(tools).toHaveProperty('assign_task_to_sprint')
})
```

Append these assertions to `tests/tools/index.test.ts`:

```ts
test('includes agile and sprint tools when provider exposes phase-five sprint features', () => {
  const tools = makeTools(provider, { storageContextId: 'user-1', chatUserId: 'user-1' })
  expect(tools).toHaveProperty('list_agiles')
  expect(tools).toHaveProperty('list_sprints')
  expect(tools).toHaveProperty('create_sprint')
  expect(tools).toHaveProperty('update_sprint')
  expect(tools).toHaveProperty('assign_task_to_sprint')
})
```

Append these assertions to `tests/providers/youtrack/tools-integration.test.ts`:

```ts
expect(toolNames).toContain('list_agiles')
expect(toolNames).toContain('list_sprints')
expect(toolNames).toContain('create_sprint')
expect(toolNames).toContain('update_sprint')
expect(toolNames).toContain('assign_task_to_sprint')
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
bun test tests/tools/agile-tools.test.ts tests/tools/tools-builder.test.ts tests/tools/index.test.ts tests/providers/youtrack/tools-integration.test.ts
```

Expected: FAIL with missing imports such as `../../src/tools/list-agiles.js` and missing builder assertions for the new tool keys.

- [ ] **Step 3: Write the minimal implementation**

In `src/providers/types.ts`, add the missing capability string just above the sprint capabilities:

```ts
  | 'agiles.list'
  | 'sprints.list'
```

In `src/providers/youtrack/constants.ts`, add the capability to the YouTrack set:

```ts
  'agiles.list',
  'sprints.list',
  'sprints.create',
  'sprints.update',
  'sprints.assign',
```

In `tests/tools/mock-provider.ts`, add the same capability to `ALL_CAPABILITIES`:

```ts
  'agiles.list',
  'sprints.list',
  'sprints.create',
  'sprints.update',
  'sprints.assign',
```

Create `src/tools/list-agiles.ts`:

```ts
import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:list-agiles' })

export function makeListAgilesTool(provider: Readonly<TaskProvider>): ToolSet[string] {
  return tool({
    description: 'List agile boards available from the current task provider.',
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const agiles = await provider.listAgiles!()
        log.info({ count: agiles.length }, 'Agiles listed via tool')
        return agiles
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), tool: 'list_agiles' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
```

Create `src/tools/list-sprints.ts`:

```ts
import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:list-sprints' })

export function makeListSprintsTool(provider: Readonly<TaskProvider>): ToolSet[string] {
  return tool({
    description: 'List sprints for a specific agile board.',
    inputSchema: z.object({
      agileId: z.string().describe('Agile board ID'),
    }),
    execute: async ({ agileId }) => {
      try {
        const sprints = await provider.listSprints!(agileId)
        log.info({ agileId, count: sprints.length }, 'Sprints listed via tool')
        return sprints
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), agileId, tool: 'list_sprints' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
```

Create `src/tools/create-sprint.ts`:

```ts
import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:create-sprint' })

export function makeCreateSprintTool(provider: Readonly<TaskProvider>): ToolSet[string] {
  return tool({
    description: 'Create a sprint on a YouTrack agile board.',
    inputSchema: z.object({
      agileId: z.string().describe('Agile board ID'),
      name: z.string().describe('Sprint name'),
      goal: z.string().optional().describe('Optional sprint goal'),
      start: z.string().optional().describe('Sprint start timestamp in ISO-8601 format'),
      finish: z.string().optional().describe('Sprint finish timestamp in ISO-8601 format'),
      previousSprintId: z.string().optional().describe('Optional previous sprint ID'),
      isDefault: z.boolean().optional().describe('Whether the sprint should become the default sprint'),
    }),
    execute: async ({ agileId, ...params }) => {
      try {
        const sprint = await provider.createSprint!(agileId, params)
        log.info({ agileId, sprintId: sprint.id }, 'Sprint created via tool')
        return sprint
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), agileId, tool: 'create_sprint' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
```

Create `src/tools/update-sprint.ts`:

```ts
import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:update-sprint' })

export function makeUpdateSprintTool(provider: Readonly<TaskProvider>): ToolSet[string] {
  return tool({
    description: 'Update a sprint on a YouTrack agile board.',
    inputSchema: z.object({
      agileId: z.string().describe('Agile board ID'),
      sprintId: z.string().describe('Sprint ID'),
      name: z.string().optional().describe('Updated sprint name'),
      goal: z.string().nullable().optional().describe('Updated sprint goal, or null to clear it'),
      start: z
        .string()
        .nullable()
        .optional()
        .describe('Updated sprint start timestamp in ISO-8601 format, or null to clear it'),
      finish: z
        .string()
        .nullable()
        .optional()
        .describe('Updated sprint finish timestamp in ISO-8601 format, or null to clear it'),
      previousSprintId: z.string().nullable().optional().describe('Updated previous sprint ID, or null to clear it'),
      isDefault: z.boolean().optional().describe('Whether the sprint should become the default sprint'),
      archived: z.boolean().optional().describe('Whether the sprint should be archived'),
    }),
    execute: async ({ agileId, sprintId, ...params }) => {
      try {
        const sprint = await provider.updateSprint!(agileId, sprintId, params)
        log.info({ agileId, sprintId: sprint.id }, 'Sprint updated via tool')
        return sprint
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), agileId, sprintId, tool: 'update_sprint' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
```

Create `src/tools/assign-task-to-sprint.ts`:

```ts
import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:assign-task-to-sprint' })

export function makeAssignTaskToSprintTool(provider: Readonly<TaskProvider>): ToolSet[string] {
  return tool({
    description: 'Assign a task to a specific sprint.',
    inputSchema: z.object({
      taskId: z.string().describe('Task ID'),
      sprintId: z.string().describe('Sprint ID'),
    }),
    execute: async ({ taskId, sprintId }) => {
      try {
        const result = await provider.assignTaskToSprint!(taskId, sprintId)
        log.info({ taskId, sprintId }, 'Task assigned to sprint via tool')
        return result
      } catch (error) {
        log.error(
          {
            error: error instanceof Error ? error.message : String(error),
            taskId,
            sprintId,
            tool: 'assign_task_to_sprint',
          },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
```

In `src/tools/tools-builder.ts`, add the imports:

```ts
import { makeAssignTaskToSprintTool } from './assign-task-to-sprint.js'
import { makeCreateSprintTool } from './create-sprint.js'
import { makeListAgilesTool } from './list-agiles.js'
import { makeListSprintsTool } from './list-sprints.js'
import { makeUpdateSprintTool } from './update-sprint.js'
```

Then add this helper near the other `maybeAdd...Tools` helpers:

```ts
function maybeAddPhaseFiveSprintTools(tools: ToolSet, provider: TaskProvider): void {
  if (provider.capabilities.has('agiles.list') && provider.listAgiles !== undefined) {
    tools['list_agiles'] = makeListAgilesTool(provider)
  }
  if (provider.capabilities.has('sprints.list') && provider.listSprints !== undefined) {
    tools['list_sprints'] = makeListSprintsTool(provider)
  }
  if (provider.capabilities.has('sprints.create') && provider.createSprint !== undefined) {
    tools['create_sprint'] = makeCreateSprintTool(provider)
  }
  if (provider.capabilities.has('sprints.update') && provider.updateSprint !== undefined) {
    tools['update_sprint'] = makeUpdateSprintTool(provider)
  }
  if (provider.capabilities.has('sprints.assign') && provider.assignTaskToSprint !== undefined) {
    tools['assign_task_to_sprint'] = makeAssignTaskToSprintTool(provider)
  }
}
```

Call it in `buildTools()` right after `maybeAddWorkItemTools(tools, provider)`:

```ts
maybeAddPhaseFiveSprintTools(tools, provider)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
bun test tests/tools/agile-tools.test.ts tests/tools/tools-builder.test.ts tests/tools/index.test.ts tests/providers/youtrack/tools-integration.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/providers/types.ts src/providers/youtrack/constants.ts src/tools/list-agiles.ts src/tools/list-sprints.ts src/tools/create-sprint.ts src/tools/update-sprint.ts src/tools/assign-task-to-sprint.ts src/tools/tools-builder.ts tests/tools/mock-provider.ts tests/tools/agile-tools.test.ts tests/tools/tools-builder.test.ts tests/tools/index.test.ts tests/providers/youtrack/tools-integration.test.ts
git commit -m "feat: expose youtrack agile and sprint tools"
```

---

### Task 2: Expose Task History And Saved Query Tools

**Files:**

- Create: `src/tools/get-task-history.ts`
- Create: `src/tools/list-saved-queries.ts`
- Create: `src/tools/run-saved-query.ts`
- Modify: `src/tools/tools-builder.ts`
- Create: `tests/tools/task-history-tools.test.ts`
- Create: `tests/tools/saved-query-tools.test.ts`
- Modify: `tests/tools/tools-builder.test.ts`
- Modify: `tests/tools/index.test.ts`
- Modify: `tests/providers/youtrack/tools-integration.test.ts`

- [ ] **Step 1: Write the failing tool tests**

Create `tests/tools/task-history-tools.test.ts`:

```ts
import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { makeGetTaskHistoryTool } from '../../src/tools/get-task-history.js'
import { getToolExecutor, mockLogger, schemaValidates } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

describe('Task history tool', () => {
  beforeEach(() => {
    mockLogger()
    mock.restore()
  })

  test('requires taskId', () => {
    const tool = makeGetTaskHistoryTool(createMockProvider())
    expect(schemaValidates(tool, {})).toBe(false)
    expect(schemaValidates(tool, { taskId: 'TEST-1' })).toBe(true)
  })

  test('forwards history filters', async () => {
    const getTaskHistory = mock(() =>
      Promise.resolve([{ id: 'act-1', timestamp: '2026-04-15T00:00:00.000Z', category: 'CommentsCategory' }]),
    )
    const tool = makeGetTaskHistoryTool(createMockProvider({ getTaskHistory }))
    const result = await getToolExecutor(tool)({
      taskId: 'TEST-1',
      categories: ['CommentsCategory'],
      limit: 20,
      offset: 0,
      reverse: true,
      start: '2026-04-01T00:00:00.000Z',
      end: '2026-04-15T00:00:00.000Z',
      author: 'alice',
    })

    expect(result).toEqual([{ id: 'act-1', timestamp: '2026-04-15T00:00:00.000Z', category: 'CommentsCategory' }])
    expect(getTaskHistory).toHaveBeenCalledWith('TEST-1', {
      categories: ['CommentsCategory'],
      limit: 20,
      offset: 0,
      reverse: true,
      start: '2026-04-01T00:00:00.000Z',
      end: '2026-04-15T00:00:00.000Z',
      author: 'alice',
    })
  })
})
```

Create `tests/tools/saved-query-tools.test.ts`:

```ts
import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { makeListSavedQueriesTool } from '../../src/tools/list-saved-queries.js'
import { makeRunSavedQueryTool } from '../../src/tools/run-saved-query.js'
import { getToolExecutor, mockLogger, schemaValidates } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

describe('Saved query tools', () => {
  beforeEach(() => {
    mockLogger()
    mock.restore()
  })

  test('list_saved_queries returns saved queries', async () => {
    const listSavedQueries = mock(() => Promise.resolve([{ id: 'query-1', name: 'Open Issues', query: 'State: Open' }]))
    const result = await getToolExecutor(makeListSavedQueriesTool(createMockProvider({ listSavedQueries })))({})
    expect(result).toEqual([{ id: 'query-1', name: 'Open Issues', query: 'State: Open' }])
    expect(listSavedQueries).toHaveBeenCalledTimes(1)
  })

  test('run_saved_query requires queryId', () => {
    const tool = makeRunSavedQueryTool(createMockProvider())
    expect(schemaValidates(tool, {})).toBe(false)
    expect(schemaValidates(tool, { queryId: 'query-1' })).toBe(true)
  })

  test('run_saved_query forwards queryId and returns search results', async () => {
    const runSavedQuery = mock(() =>
      Promise.resolve([{ id: 'TEST-1', title: 'Bug fix', status: 'Open', url: 'https://test.com/task/1' }]),
    )
    const result = await getToolExecutor(makeRunSavedQueryTool(createMockProvider({ runSavedQuery })))({
      queryId: 'query-1',
    })
    expect(result).toEqual([{ id: 'TEST-1', title: 'Bug fix', status: 'Open', url: 'https://test.com/task/1' }])
    expect(runSavedQuery).toHaveBeenCalledWith('query-1')
  })
})
```

Append these assertions to `tests/tools/tools-builder.test.ts`:

```ts
it('should expose history and saved-query tools when phase-five capabilities are present', () => {
  const provider = createMockProvider()
  const tools = buildTools(provider, 'user-123', 'user-123', 'normal')

  expect(tools).toHaveProperty('get_task_history')
  expect(tools).toHaveProperty('list_saved_queries')
  expect(tools).toHaveProperty('run_saved_query')
})
```

Append these assertions to `tests/tools/index.test.ts`:

```ts
test('includes task history and saved query tools when provider exposes them', () => {
  const tools = makeTools(provider, { storageContextId: 'user-1', chatUserId: 'user-1' })
  expect(tools).toHaveProperty('get_task_history')
  expect(tools).toHaveProperty('list_saved_queries')
  expect(tools).toHaveProperty('run_saved_query')
})
```

Append these assertions to `tests/providers/youtrack/tools-integration.test.ts`:

```ts
expect(toolNames).toContain('get_task_history')
expect(toolNames).toContain('list_saved_queries')
expect(toolNames).toContain('run_saved_query')
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
bun test tests/tools/task-history-tools.test.ts tests/tools/saved-query-tools.test.ts tests/tools/tools-builder.test.ts tests/tools/index.test.ts tests/providers/youtrack/tools-integration.test.ts
```

Expected: FAIL with missing imports and missing tool keys.

- [ ] **Step 3: Write the minimal implementation**

Create `src/tools/get-task-history.ts`:

```ts
import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:get-task-history' })

export function makeGetTaskHistoryTool(provider: Readonly<TaskProvider>): ToolSet[string] {
  return tool({
    description:
      'Read the activity history for a task, including comments, field changes, links, and visibility changes.',
    inputSchema: z.object({
      taskId: z.string().describe('Task ID'),
      categories: z.array(z.string()).optional().describe('Optional YouTrack activity category names'),
      limit: z.number().int().positive().optional().describe('Maximum number of activity items to return'),
      offset: z.number().int().min(0).optional().describe('Number of activity items to skip'),
      reverse: z.boolean().optional().describe('Whether to return history in reverse chronological order'),
      start: z.string().optional().describe('Optional inclusive start timestamp in ISO-8601 format'),
      end: z.string().optional().describe('Optional inclusive end timestamp in ISO-8601 format'),
      author: z.string().optional().describe('Optional author login or user ID filter'),
    }),
    execute: async ({ taskId, ...params }) => {
      try {
        const history = await provider.getTaskHistory!(taskId, params)
        log.info({ taskId, count: history.length }, 'Task history fetched via tool')
        return history
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), taskId, tool: 'get_task_history' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
```

Create `src/tools/list-saved-queries.ts`:

```ts
import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:list-saved-queries' })

export function makeListSavedQueriesTool(provider: Readonly<TaskProvider>): ToolSet[string] {
  return tool({
    description: 'List saved YouTrack queries available to the current user.',
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const queries = await provider.listSavedQueries!()
        log.info({ count: queries.length }, 'Saved queries listed via tool')
        return queries
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), tool: 'list_saved_queries' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
```

Create `src/tools/run-saved-query.ts`:

```ts
import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:run-saved-query' })

export function makeRunSavedQueryTool(provider: Readonly<TaskProvider>): ToolSet[string] {
  return tool({
    description: 'Run one saved YouTrack query and return normalized task search results.',
    inputSchema: z.object({
      queryId: z.string().describe('Saved query ID'),
    }),
    execute: async ({ queryId }) => {
      try {
        const tasks = await provider.runSavedQuery!(queryId)
        log.info({ queryId, count: tasks.length }, 'Saved query executed via tool')
        return tasks
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), queryId, tool: 'run_saved_query' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
```

In `src/tools/tools-builder.ts`, add these imports:

```ts
import { makeGetTaskHistoryTool } from './get-task-history.js'
import { makeListSavedQueriesTool } from './list-saved-queries.js'
import { makeRunSavedQueryTool } from './run-saved-query.js'
```

Add this helper:

```ts
function maybeAddPhaseFiveQueryTools(tools: ToolSet, provider: TaskProvider): void {
  if (provider.capabilities.has('activities.read') && provider.getTaskHistory !== undefined) {
    tools['get_task_history'] = makeGetTaskHistoryTool(provider)
  }
  if (provider.capabilities.has('queries.saved') && provider.listSavedQueries !== undefined) {
    tools['list_saved_queries'] = makeListSavedQueriesTool(provider)
  }
  if (provider.capabilities.has('queries.saved') && provider.runSavedQuery !== undefined) {
    tools['run_saved_query'] = makeRunSavedQueryTool(provider)
  }
}
```

Call it in `buildTools()` right after `maybeAddPhaseFiveSprintTools(tools, provider)`:

```ts
maybeAddPhaseFiveQueryTools(tools, provider)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
bun test tests/tools/task-history-tools.test.ts tests/tools/saved-query-tools.test.ts tests/tools/tools-builder.test.ts tests/tools/index.test.ts tests/providers/youtrack/tools-integration.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/tools/get-task-history.ts src/tools/list-saved-queries.ts src/tools/run-saved-query.ts src/tools/tools-builder.ts tests/tools/task-history-tools.test.ts tests/tools/saved-query-tools.test.ts tests/tools/tools-builder.test.ts tests/tools/index.test.ts tests/providers/youtrack/tools-integration.test.ts
git commit -m "feat: expose youtrack history and saved query tools"
```

---

### Task 3: Make Shared Task Tools Honest About Custom Fields

**Files:**

- Modify: `src/providers/domain-types.ts`
- Modify: `src/providers/types.ts`
- Modify: `src/providers/youtrack/mappers.ts`
- Modify: `src/providers/youtrack/task-helpers.ts`
- Modify: `src/providers/youtrack/operations/tasks.ts`
- Modify: `src/providers/youtrack/index.ts`
- Modify: `src/tools/create-task.ts`
- Modify: `src/tools/update-task.ts`
- Modify: `src/tools/get-task.ts`
- Modify: `tests/providers/youtrack/operations/tasks.test.ts`
- Modify: `tests/tools/create-task.test.ts`
- Modify: `tests/tools/update-task.test.ts`
- Modify: `tests/tools/get-task.test.ts`

- [ ] **Step 1: Write the failing tests**

Append this type-aware mapping test to `tests/providers/youtrack/operations/tasks.test.ts` inside `describe('getYouTrackTask', ...)`:

```ts
test('returns normalized read-only custom fields alongside the standard task fields', async () => {
  mockFetchResponse(
    makeIssueResponse({
      customFields: [
        { $type: 'SingleEnumIssueCustomField', name: 'Priority', value: { $type: 'EnumBundleElement', name: 'High' } },
        { $type: 'StateIssueCustomField', name: 'State', value: { name: 'Open' } },
        { $type: 'SimpleIssueCustomField', name: 'Environment', value: 'staging' },
        { $type: 'TextIssueCustomField', name: 'Steps', value: { $type: 'TextFieldValue', text: 'Click login' } },
      ],
    }),
  )

  const task = await getYouTrackTask(config, 'TEST-1')

  expect(task.customFields).toEqual([
    { name: 'Environment', value: 'staging' },
    { name: 'Steps', value: 'Click login' },
  ])
})
```

Append this update-path test to `tests/providers/youtrack/operations/tasks.test.ts` inside `describe('updateYouTrackTask', ...)`:

```ts
test('sends simple and text custom fields on update', async () => {
  let callCount = 0
  installFetchMock(() => {
    callCount++
    if (callCount === 1) {
      return Promise.resolve(
        new Response(JSON.stringify(makeIssueResponse({ project: { id: '0-1', shortName: 'TEST' } })), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }
    if (callCount === 2) {
      return Promise.resolve(
        new Response(
          JSON.stringify([
            {
              id: 'pcf-1',
              $type: 'SimpleProjectCustomField',
              field: { name: 'Environment', fieldType: { id: 'string', presentation: 'string' } },
              canBeEmpty: true,
            },
            {
              id: 'pcf-2',
              $type: 'TextProjectCustomField',
              field: { name: 'Steps', fieldType: { id: 'text', presentation: 'text' } },
              canBeEmpty: true,
            },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
    }
    return Promise.resolve(
      new Response(JSON.stringify(makeIssueResponse()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })

  await updateYouTrackTask(config, 'TEST-1', {
    customFields: [
      { name: 'Environment', value: 'staging' },
      { name: 'Steps', value: 'Click login' },
    ],
  })

  expect(getFetchBodyAt(2)['customFields']).toContainEqual({
    name: 'Environment',
    $type: 'SimpleIssueCustomField',
    value: 'staging',
  })
  expect(getFetchBodyAt(2)['customFields']).toContainEqual({
    name: 'Steps',
    $type: 'TextIssueCustomField',
    value: { text: 'Click login' },
  })
})
```

Append this schema test to `tests/tools/update-task.test.ts`:

```ts
test('update_task accepts customFields for provider-safe YouTrack updates', () => {
  const tool = makeUpdateTaskTool(createMockProvider())
  expect(
    schemaValidates(tool, {
      taskId: 'TEST-1',
      customFields: [
        { name: 'Environment', value: 'staging' },
        { name: 'Steps', value: 'Click login' },
      ],
    }),
  ).toBe(true)
})
```

Append this execution test to `tests/tools/update-task.test.ts`:

```ts
test('update_task forwards customFields to the provider', async () => {
  let capturedCustomFields: Array<{ name: string; value: string }> | undefined
  const updateTask = mock((_taskId: string, params: { customFields?: Array<{ name: string; value: string }> }) => {
    capturedCustomFields = params.customFields
    return Promise.resolve({ id: 'TEST-1', title: 'Test Task', status: 'todo', url: 'https://test.com/task/1' })
  })

  const tool = makeUpdateTaskTool(createMockProvider({ updateTask }))
  await getToolExecutor(tool)({
    taskId: 'TEST-1',
    customFields: [
      { name: 'Environment', value: 'staging' },
      { name: 'Steps', value: 'Click login' },
    ],
  })

  expect(capturedCustomFields).toEqual([
    { name: 'Environment', value: 'staging' },
    { name: 'Steps', value: 'Click login' },
  ])
})
```

Append this visibility test to `tests/tools/get-task.test.ts`:

```ts
test('get_task returns normalized customFields when the provider includes them', async () => {
  const getTask = mock(() =>
    Promise.resolve({
      id: 'TEST-1',
      title: 'Test Task',
      status: 'todo',
      url: 'https://test.com/task/1',
      customFields: [
        { name: 'Environment', value: 'staging' },
        { name: 'Steps', value: 'Click login' },
      ],
    }),
  )

  const result = await getToolExecutor(makeGetTaskTool(createMockProvider({ getTask })))({ taskId: 'TEST-1' })
  expect(result).toMatchObject({
    customFields: [
      { name: 'Environment', value: 'staging' },
      { name: 'Steps', value: 'Click login' },
    ],
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
bun test tests/providers/youtrack/operations/tasks.test.ts tests/tools/update-task.test.ts tests/tools/get-task.test.ts tests/tools/create-task.test.ts
```

Expected: FAIL because `Task` and `updateTask` do not yet accept or return `customFields`, and the provider does not yet build update payloads for them.

- [ ] **Step 3: Write the minimal implementation**

In `src/providers/domain-types.ts`, add a normalized read-only custom-field type and attach it to `Task`:

```ts
export type TaskCustomField = {
  name: string
  value: string | number | boolean | string[] | null
}
```

Then add it to `Task`:

```ts
  customFields?: TaskCustomField[]
```

In `src/providers/types.ts`, export the type and extend both task method signatures:

```ts
  TaskCustomField,
```

Update `createTask` and `updateTask` params to include:

```ts
    customFields?: Array<{ name: string; value: string }>
```

In `src/providers/youtrack/index.ts`, thread the new parameter into `updateTask`:

```ts
      customFields?: Array<{ name: string; value: string }>
```

In `src/providers/youtrack/task-helpers.ts`, add a shared write-safe builder for simple/text fields:

```ts
const NON_GENERIC_FIELD_NAMES = new Set(['State', 'Priority', 'Assignee', YOUTRACK_DUE_DATE_FIELD_NAME])

const buildReadOnlyCustomFieldValue = (value: unknown): string | number | boolean | string[] | null => {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'object' && 'text' in value && typeof (value as { text?: unknown }).text === 'string') {
    return (value as { text: string }).text
  }
  if (typeof value === 'object' && 'name' in value && typeof (value as { name?: unknown }).name === 'string') {
    return (value as { name: string }).name
  }
  if (typeof value === 'object' && 'login' in value && typeof (value as { login?: unknown }).login === 'string') {
    return (value as { login: string }).login
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') return item
        if (
          item !== null &&
          typeof item === 'object' &&
          'name' in item &&
          typeof (item as { name?: unknown }).name === 'string'
        ) {
          return (item as { name: string }).name
        }
        if (
          item !== null &&
          typeof item === 'object' &&
          'login' in item &&
          typeof (item as { login?: unknown }).login === 'string'
        ) {
          return (item as { login: string }).login
        }
        return undefined
      })
      .filter((item): item is string => item !== undefined)
  }
  return String(value)
}

export const buildWriteSafeCustomFields = async (
  config: Readonly<YouTrackConfig>,
  projectId: string,
  customFields: ReadonlyArray<{ name: string; value: string }> | undefined,
): Promise<CreateIssueCustomFieldPayload[]> => {
  if (customFields === undefined || customFields.length === 0) return []
  const projectFieldsByName = buildProjectFieldsByName(await fetchProjectCustomFields(config, projectId))

  return customFields.map((input) => {
    if (NON_GENERIC_FIELD_NAMES.has(input.name)) {
      throw new YouTrackClassifiedError(
        `Use the dedicated field for ${input.name}`,
        providerError.validationFailed('customFields', `Use the dedicated tool field for ${input.name}`),
      )
    }
    const projectField = projectFieldsByName.get(input.name)
    if (projectField === undefined) {
      throw new YouTrackClassifiedError(
        `Unknown custom field for update: ${input.name}`,
        providerError.validationFailed(
          'customFields',
          `${input.name} is not a known project field for this YouTrack project`,
        ),
      )
    }
    const payload = buildCreateIssueCustomField(projectField, input.value)
    if (payload === undefined) {
      throw new YouTrackClassifiedError(
        `Unsupported custom field for update: ${input.name}`,
        providerError.validationFailed(
          'customFields',
          `${input.name} only supports simple string/text writes in update_task`,
        ),
      )
    }
    return payload
  })
}
```

In `src/providers/youtrack/mappers.ts`, import `TaskCustomField` and add a mapper:

```ts
import type { TaskCustomField } from '../types.js'
```

```ts
const mapReadOnlyCustomFields = (customFields: AnyCustomField[] | undefined): TaskCustomField[] | undefined => {
  const mapped = (customFields ?? [])
    .filter((field) => !['State', 'Priority', 'Assignee', YOUTRACK_DUE_DATE_FIELD_NAME].includes(field.name))
    .map((field) => ({ name: field.name, value: buildReadOnlyCustomFieldValue(field.value) }))

  return mapped.length === 0 ? undefined : mapped
}
```

Attach it inside `mapIssueToTask()`:

```ts
    customFields: mapReadOnlyCustomFields(issue.customFields),
```

In `src/providers/youtrack/operations/tasks.ts`, extend the parameter types:

```ts
  customFields?: Array<{ name: string; value: string }>
```

Import the new helper:

```ts
  buildWriteSafeCustomFields,
```

In `createYouTrackTask()`, replace the existing custom-field assembly with:

```ts
const customFields = buildCreateCustomFields(params, projectCustomFields)
const writeSafeCustomFields = await buildWriteSafeCustomFields(config, project.id, params.customFields)
const mergedCustomFields = [...customFields, ...writeSafeCustomFields]
if (mergedCustomFields.length > 0) body['customFields'] = mergedCustomFields
```

In `updateYouTrackTask()`, fetch project context when write-safe custom fields are present:

```ts
if (params.customFields !== undefined && params.customFields.length > 0) {
  const issueRaw = await youtrackFetch(config, 'GET', `/api/issues/${taskId}`, {
    query: { fields: 'project(id)' },
  })
  const issueProject = z.object({ project: z.object({ id: z.string() }) }).parse(issueRaw)
  const projectCustomFields = await buildWriteSafeCustomFields(config, issueProject.project.id, params.customFields)
  const customFields = [...buildCustomFields(params), ...projectCustomFields]
  if (customFields.length > 0) body['customFields'] = customFields
} else {
  const customFields = buildCustomFields(params)
  if (customFields.length > 0) body['customFields'] = customFields
}
```

In `src/tools/create-task.ts`, update the `customFields` description to match the actual supported contract:

```ts
          'For YouTrack, use this only for project fields that are simple string/text values. Use dedicated fields for status, priority, assignee, and due date.',
```

In `src/tools/update-task.ts`, extend the input schema and forward the new value:

```ts
  customFields: z
    .array(z.object({ name: z.string(), value: z.string() }))
    .optional()
    .describe('Provider-safe custom field writes. For YouTrack this is limited to simple string/text project fields.'),
```

And pass it through:

```ts
    execute: async ({ taskId, title, description, status, priority, dueDate, assignee, projectId, customFields }) => {
```

```ts
          customFields,
```

No change is needed in `src/tools/get-task.ts` beyond returning the provider payload as-is, because the provider mapper will now populate `task.customFields`.

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
bun test tests/providers/youtrack/operations/tasks.test.ts tests/tools/create-task.test.ts tests/tools/update-task.test.ts tests/tools/get-task.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/providers/domain-types.ts src/providers/types.ts src/providers/youtrack/mappers.ts src/providers/youtrack/task-helpers.ts src/providers/youtrack/operations/tasks.ts src/providers/youtrack/index.ts src/tools/create-task.ts src/tools/update-task.ts src/tools/get-task.ts tests/providers/youtrack/operations/tasks.test.ts tests/tools/create-task.test.ts tests/tools/update-task.test.ts tests/tools/get-task.test.ts
git commit -m "feat: surface honest youtrack custom field support"
```

---

### Task 4: Add A YouTrack Command Escape Hatch

**Files:**

- Modify: `src/providers/domain-types.ts`
- Modify: `src/providers/types.ts`
- Modify: `src/providers/youtrack/constants.ts`
- Create: `src/providers/youtrack/operations/commands.ts`
- Modify: `src/providers/youtrack/index.ts`
- Modify: `src/providers/youtrack/prompt-addendum.ts`
- Create: `src/tools/apply-youtrack-command.ts`
- Modify: `src/tools/tools-builder.ts`
- Modify: `tests/tools/mock-provider.ts`
- Create: `tests/providers/youtrack/operations/commands.test.ts`
- Create: `tests/tools/youtrack-command.test.ts`
- Modify: `tests/tools/tools-builder.test.ts`
- Modify: `tests/providers/youtrack/tools-integration.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/providers/youtrack/operations/commands.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { z } from 'zod'

import type { YouTrackConfig } from '../../../../src/providers/youtrack/client.js'
import { applyYouTrackCommand } from '../../../../src/providers/youtrack/operations/commands.js'
import { mockLogger, restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

let fetchMock: ReturnType<typeof mock<(url: string, init: RequestInit) => Promise<Response>>> | undefined

const config: YouTrackConfig = { baseUrl: 'https://test.youtrack.cloud', token: 'test-token' }

const installFetchMock = (handler: () => Promise<Response>): void => {
  const mocked = mock<(url: string, init: RequestInit) => Promise<Response>>(handler)
  fetchMock = mocked
  setMockFetch((url: string, init: RequestInit) => mocked(url, init))
}

const FetchCallSchema = z.tuple([
  z.string(),
  z.looseObject({ method: z.string().optional(), body: z.string().optional() }),
])

const getFetchBody = (): Record<string, unknown> => {
  const parsed = FetchCallSchema.parse(fetchMock?.mock.calls[0])
  return JSON.parse(parsed[1].body ?? '{}') as Record<string, unknown>
}

beforeEach(() => {
  mockLogger()
})

afterEach(() => {
  restoreFetch()
  fetchMock = undefined
})

test('posts a command using readable issue IDs', async () => {
  installFetchMock(() =>
    Promise.resolve(
      new Response(JSON.stringify({ query: 'for me', issues: [{ id: '2-15', idReadable: 'TEST-1' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  )

  const result = await applyYouTrackCommand(config, {
    query: 'for me',
    taskIds: ['TEST-1'],
    comment: 'Assigning to myself',
    silent: true,
  })

  expect(result).toEqual({ query: 'for me', taskIds: ['TEST-1'], comment: 'Assigning to myself', silent: true })
  expect(getFetchBody()).toEqual({
    query: 'for me',
    issues: [{ idReadable: 'TEST-1' }],
    comment: 'Assigning to myself',
    silent: true,
  })
})
```

Create `tests/tools/youtrack-command.test.ts`:

```ts
import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { makeApplyYouTrackCommandTool } from '../../src/tools/apply-youtrack-command.js'
import { getToolExecutor, mockLogger, schemaValidates } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

describe('apply_youtrack_command', () => {
  beforeEach(() => {
    mockLogger()
    mock.restore()
  })

  test('requires query and taskIds', () => {
    const tool = makeApplyYouTrackCommandTool(createMockProvider({ name: 'youtrack' as const }))
    expect(schemaValidates(tool, {})).toBe(false)
    expect(schemaValidates(tool, { query: 'for me', taskIds: ['TEST-1'] })).toBe(true)
  })

  test('forwards the command payload to the provider', async () => {
    const applyCommand = mock(() => Promise.resolve({ query: 'for me', taskIds: ['TEST-1'], silent: true }))
    const tool = makeApplyYouTrackCommandTool(createMockProvider({ name: 'youtrack' as const, applyCommand }))
    const result = await getToolExecutor(tool)({ query: 'for me', taskIds: ['TEST-1'], silent: true })
    expect(result).toEqual({ query: 'for me', taskIds: ['TEST-1'], silent: true })
    expect(applyCommand).toHaveBeenCalledWith({
      query: 'for me',
      taskIds: ['TEST-1'],
      comment: undefined,
      silent: true,
    })
  })
})
```

Append these assertions to `tests/tools/tools-builder.test.ts`:

```ts
it('should expose apply_youtrack_command only for the YouTrack provider', () => {
  const provider = createMockProvider({ name: 'youtrack' as const })
  const tools = buildTools(provider, 'user-123', 'user-123', 'normal')
  expect(tools).toHaveProperty('apply_youtrack_command')

  const nonYouTrackTools = buildTools(createMockProvider({ name: 'mock' }), 'user-123', 'user-123', 'normal')
  expect(nonYouTrackTools).not.toHaveProperty('apply_youtrack_command')
})
```

Append this assertion to `tests/providers/youtrack/tools-integration.test.ts`:

```ts
expect(toolNames).toContain('apply_youtrack_command')
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
bun test tests/providers/youtrack/operations/commands.test.ts tests/tools/youtrack-command.test.ts tests/tools/tools-builder.test.ts tests/providers/youtrack/tools-integration.test.ts
```

Expected: FAIL with missing imports and missing `applyCommand` provider support.

- [ ] **Step 3: Write the minimal implementation**

In `src/providers/domain-types.ts`, add the normalized result shape:

```ts
export type TaskCommandResult = {
  query: string
  taskIds: string[]
  comment?: string
  silent?: boolean
}
```

In `src/providers/types.ts`, export it and add the capability plus provider method:

```ts
  TaskCommandResult,
```

```ts
  | 'tasks.commands'
```

```ts
  applyCommand?(params: { query: string; taskIds: string[]; comment?: string; silent?: boolean }): Promise<TaskCommandResult>
```

In `src/providers/youtrack/constants.ts`, add the capability:

```ts
  'tasks.commands',
```

Create `src/providers/youtrack/operations/commands.ts`:

```ts
import { z } from 'zod'

import { logger } from '../../../logger.js'
import type { TaskCommandResult } from '../../types.js'
import { classifyYouTrackError } from '../classify-error.js'
import type { YouTrackConfig } from '../client.js'
import { youtrackFetch } from '../client.js'

const log = logger.child({ scope: 'provider:youtrack:commands' })

const CommandResponseSchema = z.object({
  query: z.string(),
  issues: z.array(z.object({ idReadable: z.string().optional(), id: z.string() })).optional(),
})

export async function applyYouTrackCommand(
  config: YouTrackConfig,
  params: { query: string; taskIds: string[]; comment?: string; silent?: boolean },
): Promise<TaskCommandResult> {
  log.debug({ query: params.query, taskIds: params.taskIds, silent: params.silent }, 'applyYouTrackCommand')
  try {
    const body: Record<string, unknown> = {
      query: params.query,
      issues: params.taskIds.map((taskId) => ({ idReadable: taskId })),
    }
    if (params.comment !== undefined) body['comment'] = params.comment
    if (params.silent !== undefined) body['silent'] = params.silent

    const raw = await youtrackFetch(config, 'POST', '/api/commands', {
      body,
      query: { fields: 'query,issues(id,idReadable)' },
    })
    const response = CommandResponseSchema.parse(raw)
    return {
      query: response.query,
      taskIds: (response.issues ?? []).map((issue) => issue.idReadable ?? issue.id),
      comment: params.comment,
      silent: params.silent,
    }
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), query: params.query },
      'Failed to apply command',
    )
    throw classifyYouTrackError(error)
  }
}
```

In `src/providers/youtrack/index.ts`, import and wire the method:

```ts
import { applyYouTrackCommand } from './operations/commands.js'
```

```ts
  applyCommand(params: { query: string; taskIds: string[]; comment?: string; silent?: boolean }) {
    return applyYouTrackCommand(this.config, params)
  }
```

In `src/providers/youtrack/prompt-addendum.ts`, append this guidance line:

```ts
Use `apply_youtrack_command` only when the user explicitly asks for a YouTrack command-style operation or when structured tools cannot express the requested field mutation safely.
```

Create `src/tools/apply-youtrack-command.ts`:

```ts
import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:apply-youtrack-command' })

export function makeApplyYouTrackCommandTool(provider: Readonly<TaskProvider>): ToolSet[string] {
  return tool({
    description:
      'Apply a YouTrack command to one or more issues. Use this only for YouTrack-native command workflows that do not fit the structured tools.',
    inputSchema: z.object({
      query: z.string().describe('The YouTrack command string to apply, for example "for me" or "State In Progress"'),
      taskIds: z.array(z.string()).min(1).describe('One or more issue IDs such as TEST-1'),
      comment: z.string().optional().describe('Optional comment to add while applying the command'),
      silent: z.boolean().optional().describe('Whether to suppress notifications for this command when supported'),
    }),
    execute: async ({ query, taskIds, comment, silent }) => {
      try {
        const result = await provider.applyCommand!({ query, taskIds, comment, silent })
        log.info({ query, taskCount: taskIds.length }, 'YouTrack command applied via tool')
        return result
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), query, tool: 'apply_youtrack_command' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
```

In `src/tools/tools-builder.ts`, add the import:

```ts
import { makeApplyYouTrackCommandTool } from './apply-youtrack-command.js'
```

Then add this helper:

```ts
function maybeAddYouTrackCommandTool(tools: ToolSet, provider: TaskProvider): void {
  if (provider.name !== 'youtrack') return
  if (!provider.capabilities.has('tasks.commands') || provider.applyCommand === undefined) return
  tools['apply_youtrack_command'] = makeApplyYouTrackCommandTool(provider)
}
```

Call it in `buildTools()` after the phase-five query tools:

```ts
maybeAddYouTrackCommandTool(tools, provider)
```

In `tests/tools/mock-provider.ts`, add the capability and default mock method:

```ts
  'tasks.commands',
```

```ts
    applyCommand: mock((params: { query: string; taskIds: string[]; comment?: string; silent?: boolean }) => Promise.resolve(params)),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
bun test tests/providers/youtrack/operations/commands.test.ts tests/tools/youtrack-command.test.ts tests/tools/tools-builder.test.ts tests/providers/youtrack/tools-integration.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/providers/domain-types.ts src/providers/types.ts src/providers/youtrack/constants.ts src/providers/youtrack/operations/commands.ts src/providers/youtrack/index.ts src/providers/youtrack/prompt-addendum.ts src/tools/apply-youtrack-command.ts src/tools/tools-builder.ts tests/tools/mock-provider.ts tests/providers/youtrack/operations/commands.test.ts tests/tools/youtrack-command.test.ts tests/tools/tools-builder.test.ts tests/providers/youtrack/tools-integration.test.ts
git commit -m "feat: add youtrack command tool"
```

---

### Task 5: Final Regression And Surface Audit

**Files:**

- Modify: `tests/providers/youtrack/tools-integration.test.ts`
- Modify: `tests/tools/index.test.ts`
- Modify: `tests/tools/tools-builder.test.ts`

- [ ] **Step 1: Add the final surface assertions**

Make sure these assertions all exist in the YouTrack integration test:

```ts
expect(toolNames).toContain('list_agiles')
expect(toolNames).toContain('list_sprints')
expect(toolNames).toContain('create_sprint')
expect(toolNames).toContain('update_sprint')
expect(toolNames).toContain('assign_task_to_sprint')
expect(toolNames).toContain('get_task_history')
expect(toolNames).toContain('list_saved_queries')
expect(toolNames).toContain('run_saved_query')
expect(toolNames).toContain('apply_youtrack_command')
```

In `tests/tools/tools-builder.test.ts`, make sure the negative checks also exist:

```ts
it('should not expose phase-five tools when capabilities are absent', () => {
  const provider = createMockProvider({
    capabilities: new Set(
      [...createMockProvider().capabilities].filter(
        (capability) =>
          ![
            'agiles.list',
            'sprints.list',
            'sprints.create',
            'sprints.update',
            'sprints.assign',
            'activities.read',
            'queries.saved',
          ].includes(capability),
      ),
    ),
  })

  const tools = buildTools(provider, 'user-123', 'user-123', 'normal')
  expect(tools).not.toHaveProperty('list_agiles')
  expect(tools).not.toHaveProperty('list_sprints')
  expect(tools).not.toHaveProperty('create_sprint')
  expect(tools).not.toHaveProperty('update_sprint')
  expect(tools).not.toHaveProperty('assign_task_to_sprint')
  expect(tools).not.toHaveProperty('get_task_history')
  expect(tools).not.toHaveProperty('list_saved_queries')
  expect(tools).not.toHaveProperty('run_saved_query')
})
```

- [ ] **Step 2: Run the focused regression suites**

Run:

```bash
bun test tests/tools/agile-tools.test.ts tests/tools/task-history-tools.test.ts tests/tools/saved-query-tools.test.ts tests/tools/youtrack-command.test.ts tests/tools/create-task.test.ts tests/tools/update-task.test.ts tests/tools/get-task.test.ts tests/tools/tools-builder.test.ts tests/tools/index.test.ts tests/providers/youtrack/operations/agiles.test.ts tests/providers/youtrack/operations/activities.test.ts tests/providers/youtrack/operations/saved-queries.test.ts tests/providers/youtrack/operations/commands.test.ts tests/providers/youtrack/operations/tasks.test.ts tests/providers/youtrack/tools-integration.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run the repo-wide safety checks for touched files**

Run:

```bash
bun check
```

Expected: PASS for the staged/touched file set.

- [ ] **Step 4: Commit the surface audit adjustments**

Run:

```bash
git add tests/tools/tools-builder.test.ts tests/tools/index.test.ts tests/providers/youtrack/tools-integration.test.ts
git commit -m "test: lock in youtrack tool surface"
```

---

## Verification Matrix

- Agile tools: `bun test tests/tools/agile-tools.test.ts tests/providers/youtrack/operations/agiles.test.ts`
- History tools: `bun test tests/tools/task-history-tools.test.ts tests/providers/youtrack/operations/activities.test.ts`
- Saved query tools: `bun test tests/tools/saved-query-tools.test.ts tests/providers/youtrack/operations/saved-queries.test.ts`
- Custom field honesty: `bun test tests/providers/youtrack/operations/tasks.test.ts tests/tools/create-task.test.ts tests/tools/update-task.test.ts tests/tools/get-task.test.ts`
- Command tool: `bun test tests/providers/youtrack/operations/commands.test.ts tests/tools/youtrack-command.test.ts`
- Surface gating: `bun test tests/tools/tools-builder.test.ts tests/tools/index.test.ts tests/providers/youtrack/tools-integration.test.ts`

## Self-Review

**Spec coverage:**

- Missing exposed tools covered: agiles, sprints, sprint assignment, task history, saved queries.
- Biggest shared-tool gap covered: `update_task` and `get_task` now have an explicit custom-field contract instead of a silent omission.
- Missing YouTrack-native escape hatch covered: `apply_youtrack_command`.

**Placeholder scan:**

- No `TODO`, `TBD`, or “similar to previous task” shortcuts remain.
- Every task has exact file paths, concrete code snippets, exact commands, and expected results.

**Type consistency:**

- New surface names are consistent across provider, builder, tool, and test layers.
- `Task.customFields` is introduced once in normalized types and reused consistently.
- `applyCommand` / `apply_youtrack_command` naming is consistent across provider and tool layers.

Plan complete and saved to `docs/superpowers/plans/2026-04-15-youtrack-gap-closure.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
