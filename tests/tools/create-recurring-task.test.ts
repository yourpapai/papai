// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { setCachedConfig } from '../../src/cache.js'
import type { CreateRecurringTaskDeps } from '../../src/tools/create-recurring-task.js'
import { makeCreateRecurringTaskTool } from '../../src/tools/create-recurring-task.js'
import type { RecurringTaskInput, RecurringTaskRecord } from '../../src/types/recurring.js'
import { mockLogger } from '../utils/test-helpers.js'

const toolCtx = { toolCallId: '1', messages: [] as never[], context: {} }

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
    expect(capturedInput?.dtstartUtc).toMatch(/T00:00:00\.000Z$/u)
  })
})

interface SafeParseIssue {
  code: string
  message: string
  path: PropertyKey[]
}

type SafeParseOutcome = { success: true } | { success: false; error: { issues: SafeParseIssue[] } }

interface SafeParseable {
  safeParse: (data: unknown) => SafeParseOutcome
}

function isSafeParseable(val: unknown): val is SafeParseable {
  return typeof val === 'object' && val !== null && 'safeParse' in val && typeof val.safeParse === 'function'
}

describe('create-recurring-task — input validation', () => {
  let deps: CreateRecurringTaskDeps

  beforeEach(() => {
    mockLogger()
    setCachedConfig('user-1', 'timezone', 'UTC')
    deps = {
      createRecurringTask: (input: RecurringTaskInput): RecurringTaskRecord => makeRecord(input),
    }
  })

  const parseInput = (data: unknown): SafeParseOutcome => {
    const tool = makeCreateRecurringTaskTool('user-1', deps)
    if (!isSafeParseable(tool.inputSchema)) {
      throw new Error('Tool inputSchema does not have safeParse')
    }
    return tool.inputSchema.safeParse(data)
  }

  test('rejects cron without schedule with a path-scoped custom issue', () => {
    const result = parseInput({ title: 'Task', projectId: 'p1', triggerType: 'cron' })
    expect(result.success).toBe(false)
    assert(!result.success)
    expect(result.error.issues[0]?.code).toBe('custom')
    expect(result.error.issues[0]?.message).toBe("schedule is required when triggerType is 'cron'")
    expect(result.error.issues[0]?.path).toEqual(['schedule'])
  })

  test('accepts cron with schedule', () => {
    expect(
      parseInput({ title: 'Task', projectId: 'p1', triggerType: 'cron', schedule: { freq: 'DAILY' } }).success,
    ).toBe(true)
  })

  test('rejects on_complete with schedule with a path-scoped custom issue', () => {
    const result = parseInput({
      title: 'Task',
      projectId: 'p1',
      triggerType: 'on_complete',
      schedule: { freq: 'DAILY' },
    })
    expect(result.success).toBe(false)
    assert(!result.success)
    expect(result.error.issues[0]?.code).toBe('custom')
    expect(result.error.issues[0]?.message).toBe("schedule must not be provided when triggerType is 'on_complete'")
    expect(result.error.issues[0]?.path).toEqual(['schedule'])
  })

  test('accepts on_complete without schedule', () => {
    expect(parseInput({ title: 'Task', projectId: 'p1', triggerType: 'on_complete' }).success).toBe(true)
  })

  test('accepts every priority enum value', () => {
    for (const priority of ['no-priority', 'low', 'medium', 'high', 'urgent'] as const) {
      expect(parseInput({ title: 'Task', projectId: 'p1', triggerType: 'on_complete', priority }).success).toBe(true)
    }
  })

  test('rejects an invalid priority', () => {
    expect(
      parseInput({ title: 'Task', projectId: 'p1', triggerType: 'on_complete', priority: 'critical' }).success,
    ).toBe(false)
  })

  test('rejects an invalid triggerType', () => {
    expect(parseInput({ title: 'Task', projectId: 'p1', triggerType: 'weekly' }).success).toBe(false)
  })
})

describe('create-recurring-task — compile branch', () => {
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

  test('passes no rrule or dtstartUtc for on_complete', async () => {
    const tool = makeCreateRecurringTaskTool('user-1', deps)
    assert(tool.execute, 'Tool execute is undefined')
    await tool.execute({ title: 'Task', projectId: 'p1', triggerType: 'on_complete' }, toolCtx)
    expect(capturedInput?.rrule).toBeUndefined()
    expect(capturedInput?.dtstartUtc).toBeUndefined()
  })

  test('does not compile when a schedule is passed with on_complete', async () => {
    const tool = makeCreateRecurringTaskTool('user-1', deps)
    assert(tool.execute, 'Tool execute is undefined')
    await tool.execute(
      { title: 'Task', projectId: 'p1', triggerType: 'on_complete', schedule: { freq: 'DAILY' } },
      toolCtx,
    )
    expect(capturedInput?.rrule).toBeUndefined()
    expect(capturedInput?.dtstartUtc).toBeUndefined()
  })

  test('passes the compiled rrule and dtstartUtc for cron', async () => {
    const tool = makeCreateRecurringTaskTool('user-1', deps)
    assert(tool.execute, 'Tool execute is undefined')
    await tool.execute(
      {
        title: 'Task',
        projectId: 'p1',
        triggerType: 'cron',
        schedule: { freq: 'DAILY', byHour: [9], byMinute: [0], timezone: 'UTC' },
      },
      toolCtx,
    )
    expect(capturedInput?.rrule).toContain('FREQ=DAILY')
    expect(capturedInput?.rrule).toContain('BYHOUR=9')
    expect(capturedInput?.dtstartUtc).toMatch(/T00:00:00\.000Z$/u)
  })
})
