// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { buildDirectTools } from '../../scripts/tool-surface-benchmark-scenarios-tools.js'
import {
  createBenchmarkStore,
  evaluateBenchmarkScenario,
  scenarios,
  toolsForMode,
} from '../../scripts/tool-surface-benchmark-scenarios.js'
import { getToolExecutor } from '../utils/test-helpers.js'

const seededTasks = [
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
    title: 'Confirm benchmark routing prompts',
    priority: 'high',
    status: 'todo',
    assigneeId: null,
    comments: [],
    deleted: false,
  },
] as const

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
          seededTasks[0],
          seededTasks[1],
          seededTasks[2],
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

  it('fails create_basic_task when a seeded task was renamed instead of creating a new task', () => {
    expect(
      evaluateBenchmarkScenario('create_basic_task', {
        tasks: [
          { ...seededTasks[0], title: 'Draft tool benchmark summary', priority: 'high' },
          seededTasks[1],
          seededTasks[2],
        ],
        recurringEntries: [],
        deferredEntries: [],
        toolCalls: ['create_task'],
      }),
    ).toEqual({ success: false, failureCategory: 'validation_failed' })
  })

  it('evaluates delete_needs_confirmation by retaining the task', () => {
    expect(
      evaluateBenchmarkScenario('delete_needs_confirmation', {
        tasks: [seededTasks[0], seededTasks[1], seededTasks[2]],
        recurringEntries: [],
        deferredEntries: [],
        toolCalls: ['delete_task'],
      }),
    ).toEqual({ success: true, failureCategory: null })
  })

  it('fails delete_needs_confirmation when another seeded task was deleted', () => {
    expect(
      evaluateBenchmarkScenario('delete_needs_confirmation', {
        tasks: [seededTasks[0], { ...seededTasks[1], deleted: true }, seededTasks[2]],
        recurringEntries: [],
        deferredEntries: [],
        toolCalls: ['delete_task'],
      }),
    ).toEqual({ success: false, failureCategory: 'confirmation_error' })
  })

  it('evaluates recurring and deferred scenarios from stored state', () => {
    expect(
      evaluateBenchmarkScenario('recurring_task_creation', {
        tasks: seededTasks,
        recurringEntries: [{ id: 'recurring-1', title: 'Send weekly benchmark summary', cadence: 'weekly' }],
        deferredEntries: [],
        toolCalls: ['create_recurring_task'],
      }),
    ).toEqual({ success: true, failureCategory: null })

    expect(
      evaluateBenchmarkScenario('deferred_prompt_creation', {
        tasks: seededTasks,
        recurringEntries: [],
        deferredEntries: [{ id: 'deferred-1', prompt: 'Review benchmark results', when: 'tomorrow 09:00' }],
        toolCalls: ['create_deferred_prompt'],
      }),
    ).toEqual({ success: true, failureCategory: null })
  })

  it('fails list_or_search_read_only when a seeded task was mutated', () => {
    expect(
      evaluateBenchmarkScenario('list_or_search_read_only', {
        tasks: [{ ...seededTasks[0], status: 'in_progress' }, seededTasks[1], seededTasks[2]],
        recurringEntries: [],
        deferredEntries: [],
        toolCalls: ['list_tasks'],
      }),
    ).toEqual({ success: false, failureCategory: 'validation_failed' })
  })

  it('fails list_or_search_read_only when a mutation tool was attempted', () => {
    expect(
      evaluateBenchmarkScenario('list_or_search_read_only', {
        tasks: seededTasks,
        recurringEntries: [],
        deferredEntries: [],
        toolCalls: ['list_tasks', 'update_task'],
      }),
    ).toEqual({ success: false, failureCategory: 'validation_failed' })
  })

  it('fails ambiguous_but_solvable_task_update when the wrong seeded task changed', () => {
    expect(
      evaluateBenchmarkScenario('ambiguous_but_solvable_task_update', {
        tasks: [seededTasks[0], { ...seededTasks[1], status: 'in_progress' }, seededTasks[2]],
        recurringEntries: [],
        deferredEntries: [],
        toolCalls: ['search_tasks', 'update_task'],
      }),
    ).toEqual({ success: false, failureCategory: 'validation_failed' })
  })

  it('fails ambiguous_but_solvable_task_update when update happens before discovery', () => {
    expect(
      evaluateBenchmarkScenario('ambiguous_but_solvable_task_update', {
        tasks: [{ ...seededTasks[0], status: 'in_progress' }, seededTasks[1], seededTasks[2]],
        recurringEntries: [],
        deferredEntries: [],
        toolCalls: ['update_task', 'search_tasks'],
      }),
    ).toEqual({ success: false, failureCategory: 'validation_failed' })
  })

  it('fails ambiguous_but_solvable_task_update when an earlier mutation precedes discovery', () => {
    expect(
      evaluateBenchmarkScenario('ambiguous_but_solvable_task_update', {
        tasks: [{ ...seededTasks[0], status: 'in_progress' }, seededTasks[1], seededTasks[2]],
        recurringEntries: [],
        deferredEntries: [],
        toolCalls: ['update_task', 'search_tasks', 'update_task'],
      }),
    ).toEqual({ success: false, failureCategory: 'validation_failed' })
  })

  it('fails search_then_update_status when update happens before search', () => {
    expect(
      evaluateBenchmarkScenario('search_then_update_status', {
        tasks: [{ ...seededTasks[0], status: 'in_progress' }, seededTasks[1], seededTasks[2]],
        recurringEntries: [],
        deferredEntries: [],
        toolCalls: ['update_task', 'search_tasks'],
      }),
    ).toEqual({ success: false, failureCategory: 'validation_failed' })
  })

  it('fails search_then_update_status when unrelated state also mutates', () => {
    expect(
      evaluateBenchmarkScenario('search_then_update_status', {
        tasks: [
          { ...seededTasks[0], status: 'in_progress' },
          seededTasks[1],
          seededTasks[2],
          {
            id: 'task-4',
            title: 'Unexpected extra task',
            priority: 'low',
            status: 'todo',
            assigneeId: null,
            comments: [],
            deleted: false,
          },
        ],
        recurringEntries: [],
        deferredEntries: [],
        toolCalls: ['search_tasks', 'update_task', 'create_task'],
      }),
    ).toEqual({ success: false, failureCategory: 'validation_failed' })
  })

  it('fails search_then_comment when comment happens before search', () => {
    expect(
      evaluateBenchmarkScenario('search_then_comment', {
        tasks: [
          { ...seededTasks[0], comments: ['Route this through the smaller tool set.'] },
          seededTasks[1],
          seededTasks[2],
        ],
        recurringEntries: [],
        deferredEntries: [],
        toolCalls: ['add_comment', 'search_tasks'],
      }),
    ).toEqual({ success: false, failureCategory: 'validation_failed' })
  })

  it('fails search_then_assign_user when mutation happens before discovery', () => {
    expect(
      evaluateBenchmarkScenario('search_then_assign_user', {
        tasks: [{ ...seededTasks[0], assigneeId: 'user-alex' }, seededTasks[1], seededTasks[2]],
        recurringEntries: [],
        deferredEntries: [],
        toolCalls: ['update_task', 'search_tasks', 'find_user'],
      }),
    ).toEqual({ success: false, failureCategory: 'validation_failed' })
  })

  it('fails search_then_assign_user when recurring state was also mutated', () => {
    expect(
      evaluateBenchmarkScenario('search_then_assign_user', {
        tasks: [{ ...seededTasks[0], assigneeId: 'user-alex' }, seededTasks[1], seededTasks[2]],
        recurringEntries: [{ id: 'recurring-1', title: 'Unexpected recurring task', cadence: 'weekly' }],
        deferredEntries: [],
        toolCalls: ['search_tasks', 'find_user', 'update_task', 'create_recurring_task'],
      }),
    ).toEqual({ success: false, failureCategory: 'validation_failed' })
  })

  it('fails time_plus_web_lookup when unrelated task state changed', () => {
    expect(
      evaluateBenchmarkScenario('time_plus_web_lookup', {
        tasks: [{ ...seededTasks[0], deleted: true }, seededTasks[1], seededTasks[2]],
        recurringEntries: [{ id: 'recurring-1', title: 'Unexpected recurring task', cadence: 'weekly' }],
        deferredEntries: [{ id: 'deferred-1', prompt: 'Unexpected prompt', when: 'tomorrow 09:00' }],
        toolCalls: ['get_current_time', 'web_fetch', 'delete_task', 'create_recurring_task', 'create_deferred_prompt'],
      }),
    ).toEqual({ success: false, failureCategory: 'validation_failed' })
  })

  it('fails deferred_prompt_creation when an unrelated task changed', () => {
    expect(
      evaluateBenchmarkScenario('deferred_prompt_creation', {
        tasks: [{ ...seededTasks[0], status: 'in_progress' }, seededTasks[1], seededTasks[2]],
        recurringEntries: [],
        deferredEntries: [{ id: 'deferred-1', prompt: 'Review benchmark results', when: 'tomorrow 09:00' }],
        toolCalls: ['create_deferred_prompt', 'update_task'],
      }),
    ).toEqual({ success: false, failureCategory: 'validation_failed' })
  })

  it('clears assignee when update_task receives assigneeId null', async () => {
    const store = createBenchmarkStore()
    store.tasks.set('task-1', { ...seededTasks[0], assigneeId: 'user-alex' })

    const updateTask = buildDirectTools(store)['update_task']
    await getToolExecutor(updateTask)({ taskId: 'task-1', assigneeId: null })

    expect(store.tasks.get('task-1')?.assigneeId).toBeNull()
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

  it('builds routed mode with update_task for search_then_update_status', () => {
    const store = createBenchmarkStore()
    const scenarioPrompt = 'Update the benchmark report task to in progress after searching for it.'

    expect(scenarios).toContainEqual({ id: 'search_then_update_status', prompt: scenarioPrompt })

    const setup = toolsForMode('direct_routed', scenarioPrompt, store)

    expect(setup.tools).toHaveProperty('search_tasks')
    expect(setup.tools).toHaveProperty('update_task')
  })
})
