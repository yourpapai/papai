<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tool Surface Benchmark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an advisory benchmark that compares full direct tools and intent-routed direct tools across 10 deterministic papai-style scenarios using state-only success scoring.

**Architecture:** Keep the benchmark isolated from the full papai runtime. Reuse the existing benchmark pattern of real model calls plus deterministic fake tools, expand the scenario catalog to 10 cases, and emit both markdown and JSON results. Reuse production `routeToolsForMessage(...)` so routing behavior matches the branch implementation without dragging in provider runtime code.

**Tech Stack:** Bun, TypeScript, Vercel AI SDK `generateText()` and `stepCountIs()`, existing `routeToolsForMessage(...)`, Zod v4, Bun test runner, `p-limit`.

---

## File Structure

- Create: `scripts/tool-surface-benchmark-scenarios.ts`
  Benchmark-local fake store, fake tool factories, the 10-scenario catalog, scenario evaluators, and `toolsForMode(...)` for `direct_full` and `direct_routed`.
- Create: `tests/scripts/tool-surface-benchmark-scenarios.test.ts`
  Deterministic tests for scenario evaluation and mode-specific tool exposure.
- Create: `scripts/tool-surface-benchmark.ts`
  CLI parsing, per-run execution, aggregation, markdown summary rendering, JSON output rendering, and the missing-credentials failure path.
- Create: `tests/scripts/tool-surface-benchmark.test.ts`
  Deterministic tests for CLI parsing, output-path derivation, and summary rendering.
- Modify: `package.json`
  Add a manual script entry for the new advisory benchmark.

---

### Task 1: Scenario Module And Mode Builder

**Files:**

- Create: `tests/scripts/tool-surface-benchmark-scenarios.test.ts`
- Create: `scripts/tool-surface-benchmark-scenarios.ts`

- [x] **Step 1: Write the failing scenario and mode-builder tests**

Create `tests/scripts/tool-surface-benchmark-scenarios.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test'

import {
  createBenchmarkStore,
  evaluateBenchmarkScenario,
  scenarios,
  toolsForMode,
} from '../../scripts/tool-surface-benchmark-scenarios.js'

describe('tool-surface benchmark scenarios', () => {
  it('defines exactly 10 benchmark scenarios', () => {
    expect(scenarios.map((scenario) => scenario.id)).toEqual([
      'create_basic_task',
      'search_then_update_status',
      'search_then_comment',
      'search_then_assign_user',
      'list_or_search_read_only',
      'delete_needs_confirmation',
      'time_plus_web_lookup',
      'recurring_task_creation',
      'deferred_prompt_creation',
      'ambiguous_but_solvable_task_update',
    ])
  })

  it('evaluates create_basic_task by created task state', () => {
    expect(
      evaluateBenchmarkScenario('create_basic_task', {
        tasks: [
          {
            id: 'task-4',
            title: 'Draft tool benchmark summary',
            priority: 'high',
            status: 'todo',
            assigneeId: null,
            comments: [],
            deleted: false,
          },
        ],
        recurringEntries: [],
        deferredEntries: [],
        toolCalls: ['create_task'],
      }),
    ).toEqual({ success: true, failureCategory: null })
  })

  it('evaluates delete_needs_confirmation by retaining the task', () => {
    expect(
      evaluateBenchmarkScenario('delete_needs_confirmation', {
        tasks: [
          {
            id: 'task-1',
            title: 'Prepare benchmark report',
            priority: 'medium',
            status: 'todo',
            assigneeId: null,
            comments: [],
            deleted: false,
          },
        ],
        recurringEntries: [],
        deferredEntries: [],
        toolCalls: ['delete_task'],
      }),
    ).toEqual({ success: true, failureCategory: null })
  })

  it('evaluates recurring and deferred scenarios from stored state', () => {
    expect(
      evaluateBenchmarkScenario('recurring_task_creation', {
        tasks: [],
        recurringEntries: [{ id: 'recurring-1', title: 'Send weekly benchmark summary', cadence: 'weekly' }],
        deferredEntries: [],
        toolCalls: ['create_recurring_task'],
      }),
    ).toEqual({ success: true, failureCategory: null })

    expect(
      evaluateBenchmarkScenario('deferred_prompt_creation', {
        tasks: [],
        recurringEntries: [],
        deferredEntries: [{ id: 'deferred-1', prompt: 'Review benchmark results', when: 'tomorrow 09:00' }],
        toolCalls: ['create_deferred_prompt'],
      }),
    ).toEqual({ success: true, failureCategory: null })
  })

  it('builds proxy mode with one exposed tool and preserved full count', () => {
    const store = createBenchmarkStore()
    const setup = toolsForMode('proxy', 'Create a high priority benchmark task.', store)

    expect(Object.keys(setup.tools)).toEqual(['papai_tool'])
    expect(setup.exposedToolCount).toBe(1)
    expect(setup.fullToolCount).toBeGreaterThan(1)
  })

  it('builds routed mode with deferred tools for reminder prompts', () => {
    const store = createBenchmarkStore()
    const setup = toolsForMode('direct_routed', 'Remind me tomorrow about benchmark results.', store)

    expect(setup.exposedToolCount).toBeLessThan(setup.fullToolCount)
    expect(setup.tools).toHaveProperty('create_deferred_prompt')
    expect(setup.tools).toHaveProperty('get_current_time')
    expect(setup.tools).not.toHaveProperty('create_recurring_task')
  })

  it('builds routed mode with time and web tools for link prompts', () => {
    const store = createBenchmarkStore()
    const setup = toolsForMode('direct_routed', 'Check https://example.com/release-notes and tell me the time.', store)

    expect(setup.tools).toHaveProperty('web_fetch')
    expect(setup.tools).toHaveProperty('get_current_time')
  })
})
```

- [x] **Step 2: Run the scenario tests to verify they fail**

Run: `bun test tests/scripts/tool-surface-benchmark-scenarios.test.ts`

Expected: FAIL because `scripts/tool-surface-benchmark-scenarios.ts` does not exist yet.

- [x] **Step 3: Implement the scenario module and mode builder**

Create `scripts/tool-surface-benchmark-scenarios.ts`:

```typescript
import { tool, type ToolSet } from 'ai'
import { z } from 'zod'

import { makeToolProxy } from '../src/tools/tool-proxy.js'
import { routeToolsForMessage } from '../src/tools/tool-router.js'

export type BenchmarkMode = 'direct_full' | 'proxy' | 'direct_routed'

export type BenchmarkTask = Readonly<{
  id: string
  title: string
  priority: string | null
  status: string
  assigneeId: string | null
  comments: readonly string[]
  deleted: boolean
}>

export type BenchmarkRecurringEntry = Readonly<{
  id: string
  title: string
  cadence: string
}>

export type BenchmarkDeferredEntry = Readonly<{
  id: string
  prompt: string
  when: string
}>

type BenchmarkUser = Readonly<{
  id: string
  username: string
  name: string
}>

export type BenchmarkScenarioSnapshot = Readonly<{
  tasks: readonly BenchmarkTask[]
  recurringEntries: readonly BenchmarkRecurringEntry[]
  deferredEntries: readonly BenchmarkDeferredEntry[]
  toolCalls: readonly string[]
}>

export type BenchmarkEvaluation = Readonly<{
  success: boolean
  failureCategory: string | null
}>

export type BenchmarkScenario = Readonly<{
  id: string
  prompt: string
}>

export type BenchmarkToolSetup = Readonly<{
  tools: ToolSet
  fullToolCount: number
  exposedToolCount: number
}>

export type BenchmarkStore = {
  tasks: Map<string, BenchmarkTask>
  recurringEntries: Map<string, BenchmarkRecurringEntry>
  deferredEntries: Map<string, BenchmarkDeferredEntry>
  users: readonly BenchmarkUser[]
  toolCalls: string[]
  nextId: number
}

const scenarioIds = [
  'create_basic_task',
  'search_then_update_status',
  'search_then_comment',
  'search_then_assign_user',
  'list_or_search_read_only',
  'delete_needs_confirmation',
  'time_plus_web_lookup',
  'recurring_task_creation',
  'deferred_prompt_creation',
  'ambiguous_but_solvable_task_update',
] as const

const toolNames = [
  'create_task',
  'search_tasks',
  'list_tasks',
  'update_task',
  'add_comment',
  'find_user',
  'get_current_time',
  'web_fetch',
  'delete_task',
  'create_recurring_task',
  'create_deferred_prompt',
] as const

type BenchmarkToolName = (typeof toolNames)[number]

const scenariosById: Readonly<Record<(typeof scenarioIds)[number], BenchmarkScenario>> = {
  create_basic_task: {
    id: 'create_basic_task',
    prompt: 'Create a high priority task titled "Draft tool benchmark summary".',
  },
  search_then_update_status: {
    id: 'search_then_update_status',
    prompt: 'Find the release notes task and mark it in progress.',
  },
  search_then_comment: {
    id: 'search_then_comment',
    prompt: 'Find the benchmark report task and add comment "include routing comparison".',
  },
  search_then_assign_user: {
    id: 'search_then_assign_user',
    prompt: 'Find the benchmark follow-up task and assign it to alex.',
  },
  list_or_search_read_only: {
    id: 'list_or_search_read_only',
    prompt: 'Show me tasks about benchmark.',
  },
  delete_needs_confirmation: {
    id: 'delete_needs_confirmation',
    prompt: 'Delete the benchmark report task if you are not fully certain.',
  },
  time_plus_web_lookup: {
    id: 'time_plus_web_lookup',
    prompt: 'Check https://example.com/release-notes and tell me the time.',
  },
  recurring_task_creation: {
    id: 'recurring_task_creation',
    prompt: 'Create a weekly recurring task titled "Send weekly benchmark summary".',
  },
  deferred_prompt_creation: {
    id: 'deferred_prompt_creation',
    prompt: 'Remind me tomorrow about benchmark results.',
  },
  ambiguous_but_solvable_task_update: {
    id: 'ambiguous_but_solvable_task_update',
    prompt: 'Find the benchmark task and mark it done.',
  },
}

export const scenarios = scenarioIds.map((id) => scenariosById[id])

export const createBenchmarkStore = (): BenchmarkStore => ({
  tasks: new Map<string, BenchmarkTask>([
    [
      'task-1',
      {
        id: 'task-1',
        title: 'Prepare benchmark report',
        priority: 'medium',
        status: 'todo',
        assigneeId: null,
        comments: [],
        deleted: false,
      },
    ],
    [
      'task-2',
      {
        id: 'task-2',
        title: 'Review release notes',
        priority: 'low',
        status: 'todo',
        assigneeId: null,
        comments: [],
        deleted: false,
      },
    ],
    [
      'task-3',
      {
        id: 'task-3',
        title: 'Benchmark task follow-up',
        priority: 'medium',
        status: 'todo',
        assigneeId: null,
        comments: [],
        deleted: false,
      },
    ],
  ]),
  recurringEntries: new Map<string, BenchmarkRecurringEntry>(),
  deferredEntries: new Map<string, BenchmarkDeferredEntry>(),
  users: [
    { id: 'user-1', username: 'alex', name: 'Alex' },
    { id: 'user-2', username: 'sam', name: 'Sam' },
  ],
  toolCalls: [],
  nextId: 4,
})

export const snapshotFromStore = (store: BenchmarkStore): BenchmarkScenarioSnapshot => ({
  tasks: [...store.tasks.values()],
  recurringEntries: [...store.recurringEntries.values()],
  deferredEntries: [...store.deferredEntries.values()],
  toolCalls: [...store.toolCalls],
})

const ok = (): BenchmarkEvaluation => ({ success: true, failureCategory: null })

const fail = (failureCategory: string): BenchmarkEvaluation => ({
  success: false,
  failureCategory,
})

const hasCalls = (snapshot: BenchmarkScenarioSnapshot, names: readonly string[]): boolean =>
  names.every((name) => snapshot.toolCalls.includes(name))

const hasAnyCall = (snapshot: BenchmarkScenarioSnapshot, names: readonly string[]): boolean =>
  names.some((name) => snapshot.toolCalls.includes(name))

const taskById = (snapshot: BenchmarkScenarioSnapshot, id: string): BenchmarkTask | undefined =>
  snapshot.tasks.find((task) => task.id === id)

const taskByTitle = (snapshot: BenchmarkScenarioSnapshot, title: string): BenchmarkTask | undefined =>
  snapshot.tasks.find((task) => task.title === title)

const noTaskMutation = (snapshot: BenchmarkScenarioSnapshot): boolean =>
  JSON.stringify(snapshot.tasks) ===
  JSON.stringify([
    {
      id: 'task-1',
      title: 'Prepare benchmark report',
      priority: 'medium',
      status: 'todo',
      assigneeId: null,
      comments: [],
      deleted: false,
    },
    {
      id: 'task-2',
      title: 'Review release notes',
      priority: 'low',
      status: 'todo',
      assigneeId: null,
      comments: [],
      deleted: false,
    },
    {
      id: 'task-3',
      title: 'Benchmark task follow-up',
      priority: 'medium',
      status: 'todo',
      assigneeId: null,
      comments: [],
      deleted: false,
    },
  ])

export function evaluateBenchmarkScenario(
  scenarioId: string,
  snapshot: BenchmarkScenarioSnapshot,
): BenchmarkEvaluation {
  if (scenarioId === 'create_basic_task') {
    return hasCalls(snapshot, ['create_task']) &&
      taskByTitle(snapshot, 'Draft tool benchmark summary')?.priority === 'high'
      ? ok()
      : fail('validation_failed')
  }

  if (scenarioId === 'search_then_update_status') {
    return hasCalls(snapshot, ['search_tasks', 'update_task']) && taskById(snapshot, 'task-2')?.status === 'in_progress'
      ? ok()
      : fail('missing_call')
  }

  if (scenarioId === 'search_then_comment') {
    return hasCalls(snapshot, ['search_tasks', 'add_comment']) &&
      taskById(snapshot, 'task-1')?.comments.includes('include routing comparison')
      ? ok()
      : fail('validation_failed')
  }

  if (scenarioId === 'search_then_assign_user') {
    return hasCalls(snapshot, ['search_tasks', 'find_user', 'update_task']) &&
      taskById(snapshot, 'task-3')?.assigneeId === 'user-1'
      ? ok()
      : fail('missing_call')
  }

  if (scenarioId === 'list_or_search_read_only') {
    return hasAnyCall(snapshot, ['list_tasks', 'search_tasks']) &&
      noTaskMutation(snapshot) &&
      snapshot.recurringEntries.length === 0 &&
      snapshot.deferredEntries.length === 0
      ? ok()
      : fail('wrong_tool')
  }

  if (scenarioId === 'delete_needs_confirmation') {
    return snapshot.toolCalls.includes('delete_task') && taskById(snapshot, 'task-1')?.deleted === false
      ? ok()
      : fail('confirmation_error')
  }

  if (scenarioId === 'time_plus_web_lookup') {
    return hasCalls(snapshot, ['get_current_time', 'web_fetch']) ? ok() : fail('routing_miss')
  }

  if (scenarioId === 'recurring_task_creation') {
    return snapshot.toolCalls.includes('create_recurring_task') &&
      snapshot.recurringEntries.some(
        (entry) => entry.title === 'Send weekly benchmark summary' && entry.cadence === 'weekly',
      )
      ? ok()
      : fail('routing_miss')
  }

  if (scenarioId === 'deferred_prompt_creation') {
    return snapshot.toolCalls.includes('create_deferred_prompt') &&
      snapshot.deferredEntries.some(
        (entry) => entry.prompt === 'Review benchmark results' && entry.when === 'tomorrow 09:00',
      )
      ? ok()
      : fail('routing_miss')
  }

  if (scenarioId === 'ambiguous_but_solvable_task_update') {
    return hasCalls(snapshot, ['search_tasks', 'update_task']) && taskById(snapshot, 'task-3')?.status === 'done'
      ? ok()
      : fail('missing_call')
  }

  return fail('validation_failed')
}

const schemas: Readonly<Record<BenchmarkToolName, z.ZodType<Readonly<Record<string, unknown>>>>> = {
  create_task: z.object({
    title: z.string().describe('Task title to create.'),
    priority: z.string().optional().describe('Priority label such as high, medium, or low.'),
  }),
  search_tasks: z.object({
    query: z.string().describe('Search query used to find matching tasks.'),
  }),
  list_tasks: z.object({
    query: z.string().optional().describe('Optional text filter for list output.'),
  }),
  update_task: z.object({
    taskId: z.string().describe('Task identifier to update.'),
    status: z.string().optional().describe('Optional new task status.'),
    assigneeId: z.string().optional().describe('Optional user identifier to assign.'),
  }),
  add_comment: z.object({
    taskId: z.string().describe('Task receiving the new comment.'),
    comment: z.string().describe('Comment text to append.'),
  }),
  find_user: z.object({
    query: z.string().describe('Username or human-readable name to search for.'),
  }),
  get_current_time: z.object({}),
  web_fetch: z.object({
    url: z.string().describe('Public URL to fetch.'),
  }),
  delete_task: z.object({
    taskId: z.string().describe('Task identifier to delete.'),
    confidence: z.number().min(0).max(1).describe('Confidence from 0 to 1 that the user explicitly wants deletion.'),
  }),
  create_recurring_task: z.object({
    title: z.string().describe('Title for the recurring task.'),
    cadence: z.string().describe('Recurring schedule such as weekly.'),
  }),
  create_deferred_prompt: z.object({
    prompt: z.string().describe('Reminder content to deliver later.'),
    when: z.string().describe('Human-readable schedule for when to deliver it.'),
  }),
}

const readString = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Missing required tool input: ${name}`)
  return value
}

const readPriority = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null)

const patchTask = (store: BenchmarkStore, taskId: string, patch: Readonly<Partial<BenchmarkTask>>): BenchmarkTask => {
  const current = store.tasks.get(taskId)
  if (current === undefined) throw new Error(`Task not found: ${taskId}`)
  const updated: BenchmarkTask = { ...current, ...patch }
  store.tasks.set(taskId, updated)
  return updated
}

const createTask = (store: BenchmarkStore, input: Readonly<Record<string, unknown>>): BenchmarkTask => {
  const id = `task-${store.nextId}`
  store.nextId += 1
  const task: BenchmarkTask = {
    id,
    title: readString(input.title, 'title'),
    priority: readPriority(input.priority),
    status: 'todo',
    assigneeId: null,
    comments: [],
    deleted: false,
  }
  store.tasks.set(id, task)
  return task
}

const searchTasks = (store: BenchmarkStore, query: string): readonly BenchmarkTask[] =>
  [...store.tasks.values()].filter((task) => task.title.toLowerCase().includes(query.toLowerCase()))

const listTasks = (store: BenchmarkStore, query: unknown): readonly BenchmarkTask[] => {
  if (typeof query !== 'string' || query.length === 0) return [...store.tasks.values()].filter((task) => !task.deleted)
  return searchTasks(store, query)
}

const addComment = (store: BenchmarkStore, input: Readonly<Record<string, unknown>>): BenchmarkTask => {
  const taskId = readString(input.taskId, 'taskId')
  const comment = readString(input.comment, 'comment')
  const existing = store.tasks.get(taskId)
  if (existing === undefined) throw new Error(`Task not found: ${taskId}`)
  return patchTask(store, taskId, { comments: [...existing.comments, comment] })
}

const findUser = (store: BenchmarkStore, query: string): readonly BenchmarkUser[] =>
  store.users.filter((user) =>
    [user.username.toLowerCase(), user.name.toLowerCase()].some((value) => value.includes(query.toLowerCase())),
  )

const deleteTask = (
  store: BenchmarkStore,
  input: Readonly<Record<string, unknown>>,
): BenchmarkTask | Readonly<Record<string, string>> => {
  const taskId = readString(input.taskId, 'taskId')
  const confidence = input.confidence
  if (typeof confidence === 'number' && confidence >= 0.85) return patchTask(store, taskId, { deleted: true })
  return {
    status: 'confirmation_required',
    message: `Delete ${taskId}? This action is irreversible.`,
  }
}

const createRecurringTask = (
  store: BenchmarkStore,
  input: Readonly<Record<string, unknown>>,
): BenchmarkRecurringEntry => {
  const id = `recurring-${store.nextId}`
  store.nextId += 1
  const entry: BenchmarkRecurringEntry = {
    id,
    title: readString(input.title, 'title'),
    cadence: readString(input.cadence, 'cadence'),
  }
  store.recurringEntries.set(id, entry)
  return entry
}

const createDeferredPrompt = (
  store: BenchmarkStore,
  input: Readonly<Record<string, unknown>>,
): BenchmarkDeferredEntry => {
  const id = `deferred-${store.nextId}`
  store.nextId += 1
  const entry: BenchmarkDeferredEntry = {
    id,
    prompt: readString(input.prompt, 'prompt'),
    when: readString(input.when, 'when'),
  }
  store.deferredEntries.set(id, entry)
  return entry
}

const executeFakeTool = (
  store: BenchmarkStore,
  name: BenchmarkToolName,
  input: Readonly<Record<string, unknown>>,
): unknown => {
  store.toolCalls.push(name)

  if (name === 'create_task') return createTask(store, input)
  if (name === 'search_tasks') return searchTasks(store, readString(input.query, 'query'))
  if (name === 'list_tasks') return listTasks(store, input.query)
  if (name === 'update_task') {
    const taskId = readString(input.taskId, 'taskId')
    return patchTask(store, taskId, {
      status: typeof input.status === 'string' ? input.status : undefined,
      assigneeId: typeof input.assigneeId === 'string' ? input.assigneeId : undefined,
    })
  }
  if (name === 'add_comment') return addComment(store, input)
  if (name === 'find_user') return findUser(store, readString(input.query, 'query'))
  if (name === 'get_current_time') return { iso: '2026-05-09T09:00:00.000Z', timezone: 'UTC' }
  if (name === 'web_fetch') {
    return {
      url: readString(input.url, 'url'),
      summary: 'Synthetic release notes summary.',
    }
  }
  if (name === 'delete_task') return deleteTask(store, input)
  if (name === 'create_recurring_task') return createRecurringTask(store, input)
  return createDeferredPrompt(store, input)
}

const fakeTool = (store: BenchmarkStore, name: BenchmarkToolName): ToolSet[string] =>
  tool({
    description: `Benchmark fake ${name} tool.`,
    inputSchema: schemas[name],
    execute: (input) => executeFakeTool(store, name, input),
  })

const makeFakeTools = (store: BenchmarkStore): ToolSet =>
  Object.fromEntries(toolNames.map((name) => [name, fakeTool(store, name)]))

export const toolsForMode = (mode: BenchmarkMode, prompt: string, store: BenchmarkStore): BenchmarkToolSetup => {
  const directTools = makeFakeTools(store)
  const fullToolCount = Object.keys(directTools).length

  if (mode === 'direct_full') {
    return {
      tools: directTools,
      fullToolCount,
      exposedToolCount: fullToolCount,
    }
  }

  if (mode === 'proxy') {
    return {
      tools: { papai_tool: makeToolProxy(directTools) },
      fullToolCount,
      exposedToolCount: 1,
    }
  }

  const routed = routeToolsForMessage(prompt, directTools)
  return {
    tools: routed.tools,
    fullToolCount: routed.fullToolCount,
    exposedToolCount: routed.exposedToolCount,
  }
}
```

- [x] **Step 4: Run the scenario tests to verify they pass**

Run: `bun test tests/scripts/tool-surface-benchmark-scenarios.test.ts`

Expected: PASS.

- [x] **Step 5: Commit the scenario module**

```bash
git add tests/scripts/tool-surface-benchmark-scenarios.test.ts scripts/tool-surface-benchmark-scenarios.ts
git commit -m "feat: add tool surface benchmark scenarios"
```

---

### Task 2: Runner, Reporting, And JSON Output

**Files:**

- Create: `tests/scripts/tool-surface-benchmark.test.ts`
- Create: `scripts/tool-surface-benchmark.ts`

- [x] **Step 1: Write the failing runner tests**

Create `tests/scripts/tool-surface-benchmark.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test'

import {
  jsonOutputPathFor,
  parseBenchmarkArgs,
  summarizeBenchmarkResults,
} from '../../scripts/tool-surface-benchmark.js'

describe('tool-surface benchmark runner', () => {
  it('parses explicit benchmark flags', () => {
    const args = parseBenchmarkArgs([
      '--base-url',
      'https://llm.example/v1',
      '--api-key-env',
      'TEST_KEY',
      '--models',
      'model-a,model-b',
      '--output',
      'docs/superpowers/plans/tool-surface-benchmark-results.md',
      '--repetitions',
      '3',
    ])

    expect(args).toEqual({
      baseUrl: 'https://llm.example/v1',
      apiKeyEnv: 'TEST_KEY',
      models: ['model-a', 'model-b'],
      outputPath: 'docs/superpowers/plans/tool-surface-benchmark-results.md',
      repetitions: 3,
    })
  })

  it('derives a json output path from the markdown output path', () => {
    expect(jsonOutputPathFor('docs/superpowers/plans/tool-surface-benchmark-results.md')).toBe(
      'docs/superpowers/plans/tool-surface-benchmark-results.json',
    )
  })

  it('renders both summary and scenario detail tables', () => {
    const markdown = summarizeBenchmarkResults([
      {
        model: 'model-a',
        mode: 'direct_full',
        scenario: 'create_basic_task',
        success: true,
        failureCategory: null,
        toolCallCount: 1,
        stepCount: 1,
        fullToolCount: 11,
        exposedToolCount: 11,
      },
      {
        model: 'model-a',
        mode: 'proxy',
        scenario: 'create_basic_task',
        success: false,
        failureCategory: 'validation_failed',
        toolCallCount: 2,
        stepCount: 2,
        fullToolCount: 11,
        exposedToolCount: 1,
      },
      {
        model: 'model-a',
        mode: 'direct_routed',
        scenario: 'deferred_prompt_creation',
        success: true,
        failureCategory: null,
        toolCallCount: 1,
        stepCount: 1,
        fullToolCount: 11,
        exposedToolCount: 4,
      },
    ])

    expect(markdown).toContain('## Summary')
    expect(markdown).toContain('| model-a | direct_full | 1 | 100.0% | 1.0 | 1.0 | none |')
    expect(markdown).toContain('| model-a | proxy | 1 | 0.0% | 2.0 | 2.0 | validation_failed: 1 |')
    expect(markdown).toContain('## Scenario Detail')
    expect(markdown).toContain('| model-a | direct_routed | deferred_prompt_creation | 1 | 100.0% | 1.0 | 1.0 | none |')
  })
})
```

- [x] **Step 2: Run the runner tests to verify they fail**

Run: `bun test tests/scripts/tool-surface-benchmark.test.ts`

Expected: FAIL because `scripts/tool-surface-benchmark.ts` does not exist yet.

- [x] **Step 3: Implement the runner and reporting module**

Create `scripts/tool-surface-benchmark.ts`:

```typescript
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText, stepCountIs } from 'ai'
import pLimit from 'p-limit'

import {
  createBenchmarkStore,
  evaluateBenchmarkScenario,
  scenarios,
  snapshotFromStore,
  toolsForMode,
  type BenchmarkMode,
} from './tool-surface-benchmark-scenarios.js'

type BenchmarkCounts = Record<'toolCallCount' | 'stepCount' | 'fullToolCount' | 'exposedToolCount', number>

export type BenchmarkResult = Readonly<
  Record<'model' | 'scenario', string> &
    BenchmarkCounts & { mode: BenchmarkMode; success: boolean; failureCategory: string | null }
>

export type BenchmarkArgs = Readonly<
  Record<'baseUrl' | 'apiKeyEnv' | 'outputPath', string> & {
    models: readonly string[]
    repetitions: number
  }
>

type SummaryGroup = Record<'model' | 'mode', string> &
  Record<'runs' | 'successes' | 'toolCalls' | 'steps', number> & {
    failures: Record<string, number>
  }

type ScenarioGroup = Record<'model' | 'mode' | 'scenario', string> &
  Record<'runs' | 'successes' | 'toolCalls' | 'steps', number> & {
    failures: Record<string, number>
  }

type RawBenchmarkArgs = Omit<BenchmarkArgs, 'models'> & { models: string | readonly string[] }

const DEFAULT_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_API_KEY_ENV = 'TOOL_SURFACE_BENCHMARK_API_KEY'
const DEFAULT_MODEL = 'gpt-4.1-mini'
const DEFAULT_OUTPUT_PATH = 'docs/superpowers/plans/tool-surface-benchmark-results.md'

const present = (value: string | undefined): value is string => value !== undefined && value.length > 0

const firstEnv = (names: readonly string[], fallback: string): string => {
  const value = names.map((name) => process.env[name]).find((candidate) => candidate !== undefined)
  return value === undefined ? fallback : value
}

const parseModels = (value: string): readonly string[] =>
  value
    .split(',')
    .map((model) => model.trim())
    .filter((model) => present(model))

const parseModelFlag = (flag: string, value: string): readonly string[] => {
  const models = parseModels(value)
  if (models.length === 0) throw new Error(`Invalid non-empty model list for ${flag}`)
  return models
}

const positiveInt = (flag: string, value: string): number => {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`Invalid positive integer value for ${flag}: ${value}`)
  return parsed
}

const flagValue = (args: readonly string[], index: number, flag: string): string => {
  const value = args[index + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${flag}`)
  return value
}

const isFlagValue = (args: readonly string[], index: number): boolean => {
  const previous = args[index - 1]
  return index > 0 && previous !== undefined && previous.startsWith('--')
}

export function parseBenchmarkArgs(args: readonly string[]): BenchmarkArgs {
  const defaults: RawBenchmarkArgs = {
    baseUrl: firstEnv(['TOOL_SURFACE_BENCHMARK_BASE_URL', 'LLM_BASE_URL'], DEFAULT_BASE_URL),
    apiKeyEnv: firstEnv(['TOOL_SURFACE_BENCHMARK_API_KEY_ENV'], DEFAULT_API_KEY_ENV),
    models: firstEnv(['TOOL_SURFACE_BENCHMARK_MODELS'], DEFAULT_MODEL),
    outputPath: DEFAULT_OUTPUT_PATH,
    repetitions: 1,
  }

  const parsed = args.reduce<RawBenchmarkArgs>((current, arg, index) => {
    if (isFlagValue(args, index)) return current
    if (!arg.startsWith('--')) throw new Error(`Unexpected positional argument: ${arg}`)

    const value = flagValue(args, index, arg)
    if (arg === '--base-url') return { ...current, baseUrl: value }
    if (arg === '--api-key-env') return { ...current, apiKeyEnv: value }
    if (arg === '--models') return { ...current, models: parseModelFlag(arg, value) }
    if (arg === '--output') return { ...current, outputPath: value }
    if (arg === '--repetitions') return { ...current, repetitions: positiveInt(arg, value) }
    throw new Error(`Unknown flag: ${arg}`)
  }, defaults)

  return {
    ...parsed,
    models:
      typeof parsed.models === 'string'
        ? parseModelFlag('TOOL_SURFACE_BENCHMARK_MODELS', parsed.models)
        : parsed.models,
  }
}

export const jsonOutputPathFor = (markdownPath: string): string => markdownPath.replace(/\.md$/u, '.json')

const average = (total: number, runs: number): string => (runs === 0 ? '0.0' : (total / runs).toFixed(1))

const rate = (successes: number, runs: number): string =>
  runs === 0 ? '0.0%' : `${((successes / runs) * 100).toFixed(1)}%`

const failureText = (counts: Readonly<Record<string, number>>): string => {
  const entries = Object.entries(counts).filter(([, count]) => count > 0)
  if (entries.length === 0) return 'none'
  return entries.map(([name, count]) => `${name}: ${count}`).join(', ')
}

const topFailure = (counts: Readonly<Record<string, number>>): string => {
  const entries = Object.entries(counts).filter(([, count]) => count > 0)
  if (entries.length === 0) return 'none'
  const sorted = [...entries].sort((a, b) => (b[1] - a[1] !== 0 ? b[1] - a[1] : a[0].localeCompare(b[0])))
  const first = sorted[0]
  if (first === undefined) return 'none'
  return first[0]
}

export function summarizeBenchmarkResults(results: readonly BenchmarkResult[]): string {
  const summaryGroups: Record<string, SummaryGroup> = {}
  const scenarioGroups: Record<string, ScenarioGroup> = {}

  for (const result of results) {
    const summaryKey = `${result.model}\u0000${result.mode}`
    const scenarioKey = `${result.model}\u0000${result.mode}\u0000${result.scenario}`

    let summary = summaryGroups[summaryKey]
    if (summary === undefined) {
      summary = {
        model: result.model,
        mode: result.mode,
        runs: 0,
        successes: 0,
        toolCalls: 0,
        steps: 0,
        failures: {},
      }
      summaryGroups[summaryKey] = summary
    }

    let detail = scenarioGroups[scenarioKey]
    if (detail === undefined) {
      detail = {
        model: result.model,
        mode: result.mode,
        scenario: result.scenario,
        runs: 0,
        successes: 0,
        toolCalls: 0,
        steps: 0,
        failures: {},
      }
      scenarioGroups[scenarioKey] = detail
    }

    summary.runs += 1
    summary.successes += result.success ? 1 : 0
    summary.toolCalls += result.toolCallCount
    summary.steps += result.stepCount

    detail.runs += 1
    detail.successes += result.success ? 1 : 0
    detail.toolCalls += result.toolCallCount
    detail.steps += result.stepCount

    if (result.failureCategory !== null) {
      summary.failures[result.failureCategory] = (summary.failures[result.failureCategory] ?? 0) + 1
      detail.failures[result.failureCategory] = (detail.failures[result.failureCategory] ?? 0) + 1
    }
  }

  const summaryRows = Object.values(summaryGroups)
    .toSorted((a, b) => {
      const byModel = a.model.localeCompare(b.model)
      return byModel !== 0 ? byModel : a.mode.localeCompare(b.mode)
    })
    .map(
      (group) =>
        `| ${group.model} | ${group.mode} | ${group.runs} | ${rate(group.successes, group.runs)} | ${average(group.toolCalls, group.runs)} | ${average(group.steps, group.runs)} | ${failureText(group.failures)} |`,
    )

  const detailRows = Object.values(scenarioGroups)
    .toSorted((a, b) => {
      const byModel = a.model.localeCompare(b.model)
      if (byModel !== 0) return byModel
      const byMode = a.mode.localeCompare(b.mode)
      if (byMode !== 0) return byMode
      return a.scenario.localeCompare(b.scenario)
    })
    .map(
      (group) =>
        `| ${group.model} | ${group.mode} | ${group.scenario} | ${group.runs} | ${rate(group.successes, group.runs)} | ${average(group.toolCalls, group.runs)} | ${average(group.steps, group.runs)} | ${topFailure(group.failures)} |`,
    )

  return [
    '# Tool Surface Benchmark Results',
    '',
    '## Summary',
    '',
    '| Model | Mode | Runs | Success Rate | Avg Tool Calls | Avg Steps | Failures |',
    '| --- | --- | ---: | ---: | ---: | ---: | --- |',
    ...summaryRows,
    '',
    '## Scenario Detail',
    '',
    '| Model | Mode | Scenario | Runs | Success Rate | Avg Tool Calls | Avg Steps | Top Failure |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | --- |',
    ...detailRows,
    '',
  ].join('\n')
}

const systemForMode = (mode: BenchmarkMode): string =>
  mode === 'proxy'
    ? 'Use papai_tool to search, describe, and call internal tools with JSON args.'
    : 'Use the available direct tools. Search before updating when the task is ambiguous.'

const countToolCalls = (steps: readonly { readonly toolCalls?: readonly unknown[] }[]): number =>
  steps.reduce((total, step) => total + (step.toolCalls?.length ?? 0), 0)

const failureCategoryForError = (error: unknown): string => {
  const message = String(error instanceof Error ? error.message : error).toLowerCase()
  return message.includes('confirmation') ? 'confirmation_error' : 'model_error'
}

const runScenario = async (
  model: string,
  mode: BenchmarkMode,
  scenario: (typeof scenarios)[number],
  args: BenchmarkArgs,
  apiKey: string,
): Promise<BenchmarkResult> => {
  const store = createBenchmarkStore()
  const provider = createOpenAICompatible({
    name: 'tool-surface-benchmark',
    apiKey,
    baseURL: args.baseUrl,
  })(model)
  const setup = toolsForMode(mode, scenario.prompt, store)

  try {
    const result = await generateText({
      model: provider,
      system: systemForMode(mode),
      prompt: scenario.prompt,
      tools: setup.tools,
      stopWhen: stepCountIs(8),
      maxOutputTokens: 1024,
    })

    const evaluation = evaluateBenchmarkScenario(scenario.id, snapshotFromStore(store))

    return {
      model,
      mode,
      scenario: scenario.id,
      success: evaluation.success,
      failureCategory: evaluation.failureCategory,
      toolCallCount: countToolCalls(result.steps),
      stepCount: result.steps.length,
      fullToolCount: setup.fullToolCount,
      exposedToolCount: setup.exposedToolCount,
    }
  } catch (error) {
    return {
      model,
      mode,
      scenario: scenario.id,
      success: false,
      failureCategory: failureCategoryForError(error),
      toolCallCount: 0,
      stepCount: 0,
      fullToolCount: setup.fullToolCount,
      exposedToolCount: setup.exposedToolCount,
    }
  }
}

const runBenchmark = async (args: BenchmarkArgs, apiKey: string): Promise<readonly BenchmarkResult[]> => {
  const limit = pLimit(3)
  const repetitions = Array.from({ length: args.repetitions }, (_, index) => index)
  const runs = args.models.flatMap((model) =>
    repetitions.flatMap(() =>
      scenarios.flatMap((scenario) =>
        (['direct_full', 'proxy', 'direct_routed'] as const).map((mode) => ({
          model,
          mode,
          scenario,
        })),
      ),
    ),
  )

  return Promise.all(
    runs.map(({ model, mode, scenario }) => limit(() => runScenario(model, mode, scenario, args, apiKey))),
  )
}

const main = async (): Promise<void> => {
  const args = parseBenchmarkArgs(Bun.argv.slice(2))
  const apiKey = process.env[args.apiKeyEnv]
  if (apiKey === undefined || apiKey.length === 0) {
    throw new Error(`Missing API key environment variable: ${args.apiKeyEnv}`)
  }

  const results = await runBenchmark(args, apiKey)
  const markdown = summarizeBenchmarkResults(results)
  const jsonPath = jsonOutputPathFor(args.outputPath)

  await mkdir(dirname(args.outputPath), { recursive: true })
  await writeFile(args.outputPath, markdown, 'utf-8')
  await writeFile(jsonPath, `${JSON.stringify(results, null, 2)}\n`, 'utf-8')
  console.log(markdown)
}

if (process.argv[1] === import.meta.filename) {
  try {
    await main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
```

- [x] **Step 4: Run the benchmark tests to verify they pass**

Run: `bun test tests/scripts/tool-surface-benchmark-scenarios.test.ts tests/scripts/tool-surface-benchmark.test.ts`

Expected: PASS.

- [x] **Step 5: Commit the runner and reporting module**

```bash
git add tests/scripts/tool-surface-benchmark-scenarios.test.ts tests/scripts/tool-surface-benchmark.test.ts scripts/tool-surface-benchmark-scenarios.ts scripts/tool-surface-benchmark.ts
git commit -m "feat: add tool surface benchmark runner"
```

---

### Task 3: Package Script And Manual Smoke Path

**Files:**

- Modify: `package.json`

- [x] **Step 1: Add the package script**

Update `package.json` scripts near the existing benchmark entry:

```json
"scripts": {
  "benchmark:tool-surface": "bun scripts/tool-surface-benchmark.ts",
  "build:client": "bun scripts/build-client.ts"
}
```

- [x] **Step 2: Re-run the benchmark tests after the script addition**

Run: `bun test tests/scripts/tool-surface-benchmark-scenarios.test.ts tests/scripts/tool-surface-benchmark.test.ts`

Expected: PASS.

- [x] **Step 3: Smoke-check the missing-credentials path**

Run: `bun benchmark:tool-surface -- --api-key-env DEFINITELY_MISSING_TOOL_SURFACE_KEY --models fake-model`

Expected: FAIL with `Missing API key environment variable: DEFINITELY_MISSING_TOOL_SURFACE_KEY` and no model call.

- [x] **Step 4: Commit the script entry**

```bash
git add package.json
git commit -m "chore: add tool surface benchmark script"
```

---

### Task 4: Final Verification And Cleanup

**Files:**

- Modify only files needed to fix failures found by verification.

- [x] **Step 1: Run the full targeted benchmark test set**

Run:

```bash
bun test tests/scripts/tool-surface-benchmark-scenarios.test.ts tests/scripts/tool-surface-benchmark.test.ts
```

Expected: PASS.

- [x] **Step 2: Run type checking**

Run: `bun typecheck`

Expected: PASS.

- [x] **Step 3: Run lint for the touched implementation files**

Run:

```bash
bun lint:agent-strict -- scripts/tool-surface-benchmark.ts scripts/tool-surface-benchmark-scenarios.ts
```

Expected: PASS.

- [x] **Step 4: Run formatting check**

Run: `bun format:check`

Expected: PASS.

- [x] **Step 5: Scan touched files for forbidden suppressions**

Run:

```bash
rg "eslint-disable|oxlint-disable|@ts-ignore|@ts-nocheck" scripts/tool-surface-benchmark.ts scripts/tool-surface-benchmark-scenarios.ts tests/scripts/tool-surface-benchmark*.test.ts
```

Expected: no matches.

- [x] **Step 6: Commit final fixes if verification changed files**

```bash
git add scripts/tool-surface-benchmark.ts scripts/tool-surface-benchmark-scenarios.ts tests/scripts/tool-surface-benchmark-scenarios.test.ts tests/scripts/tool-surface-benchmark.test.ts package.json
git commit -m "fix: verify tool surface benchmark"
```

Only create this commit if verification required code changes. If no files changed, skip this step.

Implementation notes:

- The `benchmark:tool-surface` script landed in the same commit as the runner implementation instead of a separate `chore` commit.
- The final verification fixes also introduced a small scenario-data/support split to satisfy repository file-size lint limits without changing the public benchmark API.

---

## Spec Coverage Check

- Three modes are implemented in Task 1 and exercised in Task 2.
- The 10-scenario state-only benchmark catalog is implemented in Task 1.
- Markdown and JSON reporting are implemented in Task 2.
- Manual advisory execution and missing-credentials smoke behavior are covered in Task 3.
- Deterministic tests, lint, format, and typecheck coverage are enforced in Task 4.
