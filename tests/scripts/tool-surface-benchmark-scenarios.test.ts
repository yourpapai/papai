import { describe, expect, it } from 'bun:test'

import {
  createBenchmarkStore,
  evaluateBenchmarkScenario,
  scenarios,
  toolsForMode,
} from '../../scripts/tool-surface-benchmark-scenarios.js'

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
