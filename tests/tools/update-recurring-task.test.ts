import { describe, expect, test, beforeEach } from 'bun:test'
import assert from 'node:assert/strict'

import type { UpdateRecurringTaskDeps } from '../../src/tools/update-recurring-task.js'
import { makeUpdateRecurringTaskTool } from '../../src/tools/update-recurring-task.js'
import type { RecurringTaskRecord } from '../../src/types/recurring.js'
import { mockLogger, schemaValidates } from '../utils/test-helpers.js'

function getToolExecute(tool: ReturnType<typeof makeUpdateRecurringTaskTool>): NonNullable<typeof tool.execute> {
  assert(tool.execute, 'Tool execute is undefined')
  return tool.execute
}

const toolCtx = { toolCallId: '1', messages: [] as never[] }

function makeRecord(overrides: Partial<RecurringTaskRecord> = {}): RecurringTaskRecord {
  return {
    id: 'rec-1',
    userId: 'user-1',
    projectId: 'p1',
    title: 'Daily standup',
    description: null,
    priority: null,
    status: null,
    assignee: null,
    labels: [],
    triggerType: 'cron',
    rrule: 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0',
    dtstartUtc: '2026-03-01T09:00:00.000Z',
    timezone: 'UTC',
    enabled: true,
    catchUp: false,
    lastRun: null,
    nextRun: '2026-03-22T09:00:00.000Z',
    createdAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-03-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('makeUpdateRecurringTaskTool — timezone resolution', () => {
  let getRecurringTaskResult: RecurringTaskRecord | null
  let getRecurringTaskCalls: string[]
  let updateRecurringTaskCalls: Array<{ id: string; updates: Record<string, unknown> }>
  let deps: UpdateRecurringTaskDeps

  beforeEach(() => {
    mockLogger()
    getRecurringTaskResult = makeRecord()
    getRecurringTaskCalls = []
    updateRecurringTaskCalls = []

    deps = {
      getRecurringTask: (id: string): RecurringTaskRecord | null => {
        getRecurringTaskCalls.push(id)
        return getRecurringTaskResult
      },
      updateRecurringTask: (id: string, updates: Record<string, unknown>): RecurringTaskRecord | null => {
        updateRecurringTaskCalls.push({ id, updates })
        return getRecurringTaskResult
      },
    }
  })

  test('uses schedule.timezone for RRULE compilation', async () => {
    getRecurringTaskResult = makeRecord({ timezone: 'America/New_York' })
    deps.updateRecurringTask = (id, updates): RecurringTaskRecord | null => {
      updateRecurringTaskCalls.push({ id, updates })
      return makeRecord({ timezone: 'America/New_York' })
    }

    const tool = makeUpdateRecurringTaskTool('user-1', deps)
    const execute = getToolExecute(tool)

    await execute(
      {
        recurringTaskId: 'rec-1',
        schedule: { freq: 'DAILY', byHour: [9], byMinute: [0], timezone: 'America/New_York' },
      },
      toolCtx,
    )

    const call = updateRecurringTaskCalls[0]
    expect(call).toBeDefined()
    expect(call?.updates['rrule']).toContain('BYHOUR=9')
    expect(call?.updates['timezone']).toBe('America/New_York')
  })

  test('returns error immediately when task not found, without calling updateRecurringTask', async () => {
    getRecurringTaskResult = null

    const tool = makeUpdateRecurringTaskTool('user-1', deps)
    const execute = getToolExecute(tool)

    const result: unknown = await execute({ recurringTaskId: 'rec-missing', title: 'new' }, toolCtx)

    expect(result).toHaveProperty('error', 'Recurring task not found')
    expect(getRecurringTaskCalls).toEqual(['rec-missing'])
    expect(updateRecurringTaskCalls).toHaveLength(0)
  })

  test('schedule.timezone in RRULE input is used verbatim regardless of existing task timezone', async () => {
    getRecurringTaskResult = makeRecord({ timezone: 'America/New_York' })
    deps.updateRecurringTask = (id, updates): RecurringTaskRecord | null => {
      updateRecurringTaskCalls.push({ id, updates })
      return makeRecord()
    }

    const tool = makeUpdateRecurringTaskTool('user-1', deps)
    const execute = getToolExecute(tool)

    await execute(
      {
        recurringTaskId: 'rec-1',
        schedule: { freq: 'DAILY', byHour: [9], byMinute: [0], timezone: 'UTC' },
      },
      toolCtx,
    )

    const call = updateRecurringTaskCalls[0]
    expect(call?.updates['rrule']).toContain('BYHOUR=9')
    expect(call?.updates['timezone']).toBe('UTC')
  })

  test('calls getRecurringTask with the correct id before updating', async () => {
    const tool = makeUpdateRecurringTaskTool('user-1', deps)
    const execute = getToolExecute(tool)

    await execute({ recurringTaskId: 'rec-42', title: 'x' }, toolCtx)

    expect(getRecurringTaskCalls).toEqual(['rec-42'])
  })

  test('uses startDate and startTime as new DTSTART when provided', async () => {
    getRecurringTaskResult = makeRecord({ dtstartUtc: '2026-03-01T09:00:00.000Z' })
    deps.updateRecurringTask = (id, updates): RecurringTaskRecord | null => {
      updateRecurringTaskCalls.push({ id, updates })
      return makeRecord()
    }

    const tool = makeUpdateRecurringTaskTool('user-1', deps)
    const execute = getToolExecute(tool)

    await execute(
      {
        recurringTaskId: 'rec-1',
        schedule: {
          freq: 'DAILY',
          byHour: [8],
          byMinute: [30],
          timezone: 'UTC',
          startDate: '2026-07-01',
          startTime: '08:30',
        },
      },
      toolCtx,
    )

    expect(updateRecurringTaskCalls[0]?.updates['dtstartUtc']).toBe('2026-07-01T08:30:00.000Z')
  })

  test('preserves existing DTSTART when schedule is updated without startDate', async () => {
    getRecurringTaskResult = makeRecord({ dtstartUtc: '2026-03-01T09:00:00.000Z' })
    deps.updateRecurringTask = (id, updates): RecurringTaskRecord | null => {
      updateRecurringTaskCalls.push({ id, updates })
      return makeRecord()
    }

    const tool = makeUpdateRecurringTaskTool('user-1', deps)
    const execute = getToolExecute(tool)

    await execute(
      {
        recurringTaskId: 'rec-1',
        schedule: { freq: 'DAILY', byHour: [10], byMinute: [0], timezone: 'UTC' },
      },
      toolCtx,
    )

    expect(updateRecurringTaskCalls[0]?.updates['dtstartUtc']).toBe('2026-03-01T09:00:00.000Z')
  })

  test('promotes triggerType to cron when schedule is provided for an on_complete task', async () => {
    getRecurringTaskResult = makeRecord({ triggerType: 'on_complete', rrule: null, dtstartUtc: null, nextRun: null })
    deps.updateRecurringTask = (id, updates): RecurringTaskRecord | null => {
      updateRecurringTaskCalls.push({ id, updates })
      return makeRecord({ triggerType: 'cron' })
    }

    const tool = makeUpdateRecurringTaskTool('user-1', deps)
    const execute = getToolExecute(tool)

    await execute(
      {
        recurringTaskId: 'rec-1',
        schedule: { freq: 'DAILY', byHour: [9], byMinute: [0], timezone: 'UTC' },
      },
      toolCtx,
    )

    expect(updateRecurringTaskCalls[0]?.updates['triggerType']).toBe('cron')
  })

  test('anchors DTSTART at midnight when promoting on_complete to cron without startDate', async () => {
    getRecurringTaskResult = makeRecord({ triggerType: 'on_complete', rrule: null, dtstartUtc: null, nextRun: null })
    deps.updateRecurringTask = (id, updates): RecurringTaskRecord | null => {
      updateRecurringTaskCalls.push({ id, updates })
      return makeRecord({ triggerType: 'cron' })
    }

    const tool = makeUpdateRecurringTaskTool('user-1', deps)
    const execute = getToolExecute(tool)

    await execute(
      {
        recurringTaskId: 'rec-1',
        schedule: { freq: 'DAILY', timezone: 'UTC' },
      },
      toolCtx,
    )

    expect(updateRecurringTaskCalls[0]?.updates['dtstartUtc']).toMatch(/T00:00:00\.000Z$/)
  })

  test('does not include triggerType in updates when no schedule is provided', async () => {
    const tool = makeUpdateRecurringTaskTool('user-1', deps)
    const execute = getToolExecute(tool)

    await execute({ recurringTaskId: 'rec-1', title: 'renamed' }, toolCtx)

    expect(updateRecurringTaskCalls[0]?.updates).not.toHaveProperty('triggerType')
  })

  test('switches cron task to on_complete and passes triggerType without schedule fields', async () => {
    getRecurringTaskResult = makeRecord({ triggerType: 'cron' })

    const tool = makeUpdateRecurringTaskTool('user-1', deps)
    const execute = getToolExecute(tool)

    await execute({ recurringTaskId: 'rec-1', triggerType: 'on_complete' }, toolCtx)

    const call = updateRecurringTaskCalls[0]
    expect(call?.updates['triggerType']).toBe('on_complete')
    expect(call?.updates).not.toHaveProperty('rrule')
    expect(call?.updates).not.toHaveProperty('dtstartUtc')
    expect(call?.updates).not.toHaveProperty('timezone')
  })

  test('rejects on_complete combined with a schedule', () => {
    const tool = makeUpdateRecurringTaskTool('user-1', deps)
    expect(
      schemaValidates(tool, {
        recurringTaskId: 'rec-1',
        triggerType: 'on_complete',
        schedule: { freq: 'DAILY', timezone: 'UTC' },
      }),
    ).toBe(false)
  })

  test('rejects cron without a schedule', () => {
    const tool = makeUpdateRecurringTaskTool('user-1', deps)
    expect(schemaValidates(tool, { recurringTaskId: 'rec-1', triggerType: 'cron' })).toBe(false)
  })
})
