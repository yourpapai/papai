import { beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert'

import { setConfig } from '../../src/config.js'
import { executeCreate, executeList, executeUpdate } from '../../src/deferred-prompts/tool-handlers.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const USER_ID = 'user-tz-test'

beforeEach(async () => {
  mockLogger()
  await setupTestDb()
})

describe('executeCreate — rrule timezone', () => {
  test('initial fireAt respects user local timezone, not UTC', () => {
    // Asia/Karachi = UTC+5; byHour: [9] means 09:00 local = 04:00 UTC
    setConfig(USER_ID, 'timezone', 'Asia/Karachi')
    const result = executeCreate(USER_ID, {
      prompt: 'Daily',
      schedule: { rrule: { freq: 'DAILY', byHour: [9], byMinute: [0], timezone: 'Asia/Karachi' } },
    })

    expect(result).not.toHaveProperty('error')
    assert(typeof result === 'object')
    assert(result !== null)
    assert('fireAt' in result)
    // Returned fireAt is converted back to local time; must be 09:xx
    expect(result.fireAt).toContain('09:')
  })

  test('UTC user is unaffected', () => {
    setConfig(USER_ID, 'timezone', 'UTC')
    const result = executeCreate(USER_ID, {
      prompt: 'Daily',
      schedule: { rrule: { freq: 'DAILY', byHour: [9], byMinute: [0], timezone: 'UTC' } },
    })
    expect(result).not.toHaveProperty('error')
    assert(typeof result === 'object')
    assert(result !== null)
    assert('fireAt' in result)
    expect(result.fireAt).toContain('09:')
  })
})

describe('executeUpdate — rrule timezone', () => {
  test('update rrule on existing prompt stores correct rrule string', () => {
    setConfig(USER_ID, 'timezone', 'Asia/Karachi')

    executeCreate(USER_ID, {
      prompt: 'Daily',
      schedule: { rrule: { freq: 'DAILY', byHour: [9], byMinute: [0], timezone: 'Asia/Karachi' } },
    })
    const { prompts } = executeList(USER_ID, { type: 'scheduled' })
    expect(prompts).toHaveLength(1)
    const id = prompts[0]!.id

    const updated = executeUpdate(USER_ID, {
      id,
      schedule: { rrule: { freq: 'DAILY', byHour: [10], byMinute: [0], timezone: 'Asia/Karachi' } },
    })
    expect(updated).not.toHaveProperty('error')
    assert(typeof updated === 'object')
    assert(updated !== null)
    assert('rrule' in updated)
    expect(String(updated.rrule)).toBe('FREQ=DAILY;BYHOUR=10;BYMINUTE=0')
  })

  test('update rrule recomputes fireAt to reflect new rule immediately', () => {
    setConfig(USER_ID, 'timezone', 'UTC')

    executeCreate(USER_ID, {
      prompt: 'Daily',
      schedule: { rrule: { freq: 'DAILY', byHour: [9], byMinute: [0], timezone: 'UTC' } },
    })
    const { prompts: before } = executeList(USER_ID, { type: 'scheduled' })
    const existing = before[0]!
    assert(existing.type === 'scheduled')
    const originalFireAt = existing.fireAt

    const updated = executeUpdate(USER_ID, {
      id: existing.id,
      schedule: { rrule: { freq: 'DAILY', byHour: [22], byMinute: [0], timezone: 'UTC' } },
    })
    expect(updated).not.toHaveProperty('error')
    assert(typeof updated === 'object')
    assert(updated !== null)
    assert('fireAt' in updated)
    // fireAt must change to reflect the new rule immediately (not remain at the old 09:xx value)
    expect(updated.fireAt).not.toBe(originalFireAt)
    expect(updated.fireAt).toContain('T22:')
  })

  test('create with no byHour/byMinute anchors DTSTART at midnight of the rrule timezone', () => {
    setConfig(USER_ID, 'timezone', 'UTC')
    executeCreate(USER_ID, {
      prompt: 'Weekly on Monday',
      schedule: { rrule: { freq: 'WEEKLY', byDay: ['MO'], timezone: 'UTC' } },
    })
    const { prompts } = executeList(USER_ID, { type: 'scheduled' })
    expect(prompts).toHaveLength(1)
    const prompt = prompts[0]!
    assert(prompt.type === 'scheduled')
    expect(prompt.dtstartUtc).toMatch(/T00:00:00\.000Z$/)
  })

  test('update rrule preserves original dtstartUtc series anchor', () => {
    setConfig(USER_ID, 'timezone', 'UTC')

    executeCreate(USER_ID, {
      prompt: 'Daily',
      schedule: { rrule: { freq: 'DAILY', byHour: [9], byMinute: [0], timezone: 'UTC' } },
    })
    const { prompts: before } = executeList(USER_ID, { type: 'scheduled' })
    const existing = before[0]!
    assert(existing.type === 'scheduled')
    const originalDtstartUtc = existing.dtstartUtc

    executeUpdate(USER_ID, {
      id: existing.id,
      schedule: { rrule: { freq: 'DAILY', byHour: [10], byMinute: [0], timezone: 'UTC' } },
    })
    const { prompts: after } = executeList(USER_ID, { type: 'scheduled' })
    const afterFirst = after[0]!
    assert(afterFirst.type === 'scheduled')
    // dtstartUtc must equal the original series anchor, not the edit timestamp
    expect(afterFirst.dtstartUtc).toBe(originalDtstartUtc)
  })
})
