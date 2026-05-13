import { beforeEach, describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import type { CompletionHookDeps } from '../../src/tools/completion-hook.js'
import { completionHook } from '../../src/tools/completion-hook.js'
import type { RecurringTaskRecord } from '../../src/types/recurring.js'
import { mockLogger } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

const TEMPLATE_ID = 'template-1'
const PROJECT_ID = 'project-1'

const makeTemplate = (overrides: Partial<RecurringTaskRecord> = {}): RecurringTaskRecord => ({
  id: TEMPLATE_ID,
  userId: 'user-1',
  projectId: PROJECT_ID,
  title: 'Deploy review',
  description: null,
  priority: 'high',
  status: null,
  assignee: 'alice',
  labels: ['label-1'],
  triggerType: 'on_complete',
  rrule: null,
  dtstartUtc: null,
  timezone: 'UTC',
  enabled: true,
  catchUp: false,
  lastRun: null,
  nextRun: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
})

const COMPLETION_STATUSES = ['done', 'completed', 'closed', 'resolved']

function createDeps(overrides: Partial<CompletionHookDeps> = {}): CompletionHookDeps & {
  recordOccurrenceCalls: Array<{ templateId: string; taskId: string }>
  markExecutedCalls: string[]
} {
  const recordOccurrenceCalls: Array<{ templateId: string; taskId: string }> = []
  const markExecutedCalls: string[] = []
  return {
    findTemplateByTaskId: (): RecurringTaskRecord | null => null,
    isCompletionStatus: (status: string): boolean => {
      const lower = status.toLowerCase()
      return COMPLETION_STATUSES.some((s) => lower.includes(s))
    },
    recordOccurrence: (templateId: string, taskId: string): void => {
      recordOccurrenceCalls.push({ templateId, taskId })
    },
    markExecuted: (id: string): void => {
      markExecutedCalls.push(id)
    },
    recordOccurrenceCalls,
    markExecutedCalls,
    ...overrides,
  }
}

describe('completionHook', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('fires when status transitions to done and on_complete template exists', async () => {
    const template = makeTemplate()
    const deps = createDeps({
      findTemplateByTaskId: (): RecurringTaskRecord => template,
    })
    const createTask = mock(() =>
      Promise.resolve({
        id: 'new-task-1',
        title: 'Deploy review',
        status: 'todo',
        url: 'https://test.com/task/new-1',
      }),
    )
    const provider = createMockProvider({ createTask })

    await completionHook('completed-task-1', 'done', provider, deps)

    expect(createTask).toHaveBeenCalledTimes(1)
    const calls = createTask.mock.calls
    assert(calls.length > 0, 'Expected createTask to be called')
    const firstArg: unknown = calls[0]
    expect(firstArg).toMatchObject([
      {
        projectId: PROJECT_ID,
        title: 'Deploy review',
        priority: 'high',
        assignee: 'alice',
      },
    ])

    // Should have recorded the new occurrence
    expect(deps.recordOccurrenceCalls).toHaveLength(1)
    expect(deps.recordOccurrenceCalls[0]).toEqual({ templateId: TEMPLATE_ID, taskId: 'new-task-1' })

    // Should have marked the template as executed
    expect(deps.markExecutedCalls).toEqual([TEMPLATE_ID])
  })

  test('does not fire when no matching template exists', async () => {
    const deps = createDeps()
    const createTask = mock(() => Promise.resolve({ id: 'x', title: 'x', status: 'todo', url: 'https://test.com' }))
    const provider = createMockProvider({ createTask })

    await completionHook('unknown-task', 'done', provider, deps)

    expect(createTask).not.toHaveBeenCalled()
    expect(deps.recordOccurrenceCalls).toHaveLength(0)
  })

  test('does not fire for non-completion statuses', async () => {
    const template = makeTemplate()
    const deps = createDeps({
      findTemplateByTaskId: (): RecurringTaskRecord => template,
    })
    const createTask = mock(() => Promise.resolve({ id: 'x', title: 'x', status: 'todo', url: 'https://test.com' }))
    const provider = createMockProvider({ createTask })

    await completionHook('task-1', 'in-progress', provider, deps)

    expect(createTask).not.toHaveBeenCalled()
  })

  test('does not fire for cron-based templates', async () => {
    const template = makeTemplate({
      triggerType: 'cron',
      rrule: 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0',
    })
    const deps = createDeps({
      findTemplateByTaskId: (): RecurringTaskRecord => template,
    })
    const createTask = mock(() => Promise.resolve({ id: 'x', title: 'x', status: 'todo', url: 'https://test.com' }))
    const provider = createMockProvider({ createTask })

    await completionHook('cron-task-1', 'done', provider, deps)

    expect(createTask).not.toHaveBeenCalled()
  })

  test('does not fire when template is paused', async () => {
    const template = makeTemplate({ enabled: false })
    const deps = createDeps({
      findTemplateByTaskId: (): RecurringTaskRecord => template,
    })
    const createTask = mock(() => Promise.resolve({ id: 'x', title: 'x', status: 'todo', url: 'https://test.com' }))
    const provider = createMockProvider({ createTask })

    await completionHook('paused-task-1', 'done', provider, deps)

    expect(createTask).not.toHaveBeenCalled()
  })

  test('applies labels when provider supports it', async () => {
    const template = makeTemplate({ labels: ['label-1', 'label-2'] })
    const deps = createDeps({
      findTemplateByTaskId: (): RecurringTaskRecord => template,
    })
    const createTask = mock(() =>
      Promise.resolve({ id: 'new-task-1', title: 'Test', status: 'todo', url: 'https://test.com' }),
    )
    const addTaskLabel = mock(() => Promise.resolve({ taskId: 'new-task-1', labelId: 'label-1' }))
    const provider = createMockProvider({ createTask, addTaskLabel })

    await completionHook('task-1', 'done', provider, deps)

    expect(addTaskLabel).toHaveBeenCalledTimes(2)
  })

  test('no error when completionHook is not provided to makeUpdateTaskTool', async () => {
    const { makeUpdateTaskTool } = await import('../../src/tools/update-task.js')
    const provider = createMockProvider()

    // Should not throw when completionHook is omitted
    const tool = makeUpdateTaskTool(provider)
    expect(tool.description).toContain('Update')
  })
})
