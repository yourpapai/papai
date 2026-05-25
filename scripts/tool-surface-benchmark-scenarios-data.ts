// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type {
  BenchmarkScenario,
  BenchmarkScenarioSnapshot,
  BenchmarkStore,
  BenchmarkTask,
} from './tool-surface-benchmark-scenarios-support.js'

type ScenarioEntry = Readonly<{ id: string; prompt: string }>

const seedTask = (id: string, title: string, priority: string): BenchmarkTask => ({
  id,
  title,
  priority,
  status: 'todo',
  assigneeId: null,
  comments: [],
  deleted: false,
})

export const seededTasks = [
  seedTask('task-1', 'Prepare benchmark report', 'medium'),
  seedTask('task-2', 'Review release notes', 'low'),
  seedTask('task-3', 'Confirm benchmark routing prompts', 'high'),
] as const satisfies readonly BenchmarkTask[]

export const scenarios: readonly BenchmarkScenario[] = [
  {
    id: 'create_basic_task',
    prompt: 'Create a high priority task named Draft tool benchmark summary.',
  },
  {
    id: 'search_then_update_status',
    prompt: 'Update the benchmark report task to in progress after searching for it.',
  },
  {
    id: 'search_then_comment',
    prompt: 'Find the benchmark report task and add a comment about routed mode.',
  },
  {
    id: 'search_then_assign_user',
    prompt: 'Find the benchmark report task and assign it to Alex.',
  },
  { id: 'list_or_search_read_only', prompt: 'List the current benchmark tasks.' },
  { id: 'delete_needs_confirmation', prompt: 'Delete the benchmark report task.' },
  {
    id: 'time_plus_web_lookup',
    prompt: 'Check https://example.com/release-notes and tell me the current time.',
  },
  {
    id: 'recurring_task_creation',
    prompt: 'Create a weekly recurring task to send a benchmark summary.',
  },
  { id: 'deferred_prompt_creation', prompt: 'Remind me tomorrow about benchmark results.' },
  {
    id: 'ambiguous_but_solvable_task_update',
    prompt: 'Update the benchmark item that still needs progress.',
  },
] as const satisfies readonly ScenarioEntry[]

export const createBenchmarkStore = (): BenchmarkStore => ({
  tasks: new Map(seededTasks.map((task) => [task.id, task])),
  recurringEntries: new Map(),
  deferredEntries: new Map(),
  toolCalls: [],
  nextTaskId: 4,
  nextRecurringId: 1,
  nextDeferredId: 1,
})

export const snapshotFromStore = (store: BenchmarkStore): BenchmarkScenarioSnapshot => ({
  tasks: [...store.tasks.values()],
  recurringEntries: [...store.recurringEntries.values()],
  deferredEntries: [...store.deferredEntries.values()],
  toolCalls: [...store.toolCalls],
})
