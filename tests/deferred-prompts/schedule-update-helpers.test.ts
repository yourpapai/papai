import { beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { setConfig } from '../../src/config.js'
import { buildScheduleUpdates } from '../../src/deferred-prompts/schedule-update-helpers.js'
import { executeCreate, executeList } from '../../src/deferred-prompts/tool-handlers.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const USER_ID = 'user-schedule-update-helpers'

beforeEach(async () => {
  mockLogger()
  await setupTestDb()
  setConfig(USER_ID, 'timezone', 'UTC')
})

describe('buildScheduleUpdates — fire_at only', () => {
  test('returns fireAt and nulls out recurrence fields', () => {
    const result = buildScheduleUpdates('any-id', USER_ID, {
      fire_at: { date: '2099-01-01', time: '09:00' },
    })
    expect(result).not.toHaveProperty('error')
    assert(!('error' in result))
    expect(result.fireAt).toBeDefined()
    expect(result.rrule).toBeNull()
    expect(result.dtstartUtc).toBeNull()
    expect(result.timezone).toBeNull()
  })

  test('returns error for invalid fire_at datetime', () => {
    const result = buildScheduleUpdates('any-id', USER_ID, {
      fire_at: { date: 'not-a-date', time: '09:00' },
    })
    expect(result).toHaveProperty('error')
  })

  test('returns error for fire_at in the past', () => {
    const result = buildScheduleUpdates('any-id', USER_ID, {
      fire_at: { date: '2000-01-01', time: '09:00' },
    })
    expect(result).toHaveProperty('error')
  })
})

describe('buildScheduleUpdates — rrule', () => {
  test('returns recurrence fields for a known prompt', () => {
    executeCreate(USER_ID, {
      prompt: 'Daily',
      schedule: { rrule: { freq: 'DAILY', byHour: [9], byMinute: [0], timezone: 'UTC' } },
    })
    const { prompts } = executeList(USER_ID, { type: 'scheduled' })
    const id = prompts[0]!.id

    const result = buildScheduleUpdates(id, USER_ID, {
      rrule: { freq: 'DAILY', byHour: [10], byMinute: [0], timezone: 'UTC' },
    })
    expect(result).not.toHaveProperty('error')
    assert(!('error' in result))
    expect(result.rrule).toBe('FREQ=DAILY;BYHOUR=10;BYMINUTE=0')
    expect(result.dtstartUtc).toBeDefined()
    expect(result.fireAt).toBeDefined()
  })

  test('returns error when prompt not found', () => {
    const result = buildScheduleUpdates('nonexistent-id', USER_ID, {
      rrule: { freq: 'DAILY', byHour: [9], byMinute: [0], timezone: 'UTC' },
    })
    expect(result).toHaveProperty('error')
  })
})
