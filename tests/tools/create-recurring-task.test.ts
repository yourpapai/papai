import { beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { setCachedConfig } from '../../src/cache.js'
import type { CreateRecurringTaskDeps } from '../../src/tools/create-recurring-task.js'
import { makeCreateRecurringTaskTool } from '../../src/tools/create-recurring-task.js'
import type { RecurringTaskInput, RecurringTaskRecord } from '../../src/types/recurring.js'
import { mockLogger } from '../utils/test-helpers.js'

const toolCtx = { toolCallId: '1', messages: [] as never[] }

function makeRecord(input: RecurringTaskInput): RecurringTaskRecord {
  return {
    id: 'rec-1',
    userId: 'user-1',
    projectId: input.projectId,
    title: input.title,
    description: null,
    priority: null,
    status: null,
    assignee: null,
    labels: [],
    triggerType: input.triggerType,
    rrule: input.rrule ?? null,
    dtstartUtc: input.dtstartUtc ?? null,
    timezone: input.timezone ?? 'UTC',
    enabled: true,
    catchUp: false,
    lastRun: null,
    nextRun: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

describe('create-recurring-task — DTSTART anchor', () => {
  let capturedInput: RecurringTaskInput | null
  let deps: CreateRecurringTaskDeps

  beforeEach(() => {
    mockLogger()
    capturedInput = null
    setCachedConfig('user-1', 'timezone', 'UTC')
    deps = {
      createRecurringTask: (input: RecurringTaskInput): RecurringTaskRecord => {
        capturedInput = input
        return makeRecord(input)
      },
    }
  })

  test('uses startDate and startTime as DTSTART when provided', async () => {
    const tool = makeCreateRecurringTaskTool('user-1', deps)
    assert(tool.execute, 'Tool execute is undefined')
    await tool.execute(
      {
        title: 'Task',
        projectId: 'p1',
        triggerType: 'cron',
        schedule: {
          freq: 'DAILY',
          byHour: [9],
          byMinute: [0],
          timezone: 'UTC',
          startDate: '2026-06-01',
          startTime: '09:00',
        },
      },
      toolCtx,
    )
    expect(capturedInput?.dtstartUtc).toBe('2026-06-01T09:00:00.000Z')
  })

  test('uses startDate at midnight when startTime is omitted', async () => {
    const tool = makeCreateRecurringTaskTool('user-1', deps)
    assert(tool.execute, 'Tool execute is undefined')
    await tool.execute(
      {
        title: 'Task',
        projectId: 'p1',
        triggerType: 'cron',
        schedule: {
          freq: 'WEEKLY',
          byDay: ['MO'],
          timezone: 'UTC',
          startDate: '2026-06-01',
        },
      },
      toolCtx,
    )
    expect(capturedInput?.dtstartUtc).toBe('2026-06-01T00:00:00.000Z')
  })

  test('falls back to midnight today when startDate is omitted', async () => {
    const tool = makeCreateRecurringTaskTool('user-1', deps)
    assert(tool.execute, 'Tool execute is undefined')
    await tool.execute(
      {
        title: 'Task',
        projectId: 'p1',
        triggerType: 'cron',
        schedule: { freq: 'WEEKLY', byDay: ['MO'], timezone: 'UTC' },
      },
      toolCtx,
    )
    expect(capturedInput?.dtstartUtc).toMatch(/T00:00:00\.000Z$/)
  })
})
