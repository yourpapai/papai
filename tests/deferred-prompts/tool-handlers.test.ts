// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert'

import { setCachedConfig } from '../../src/cache.js'
import { toScopedContextId, toScopedThreadContextId } from '../../src/chat/scoped-context.js'
import { setConfig } from '../../src/config.testing.js'
import { subscribe, unsubscribe, type DebugEvent } from '../../src/debug/event-bus.js'
import { getAlertPrompt, listAlertPrompts } from '../../src/deferred-prompts/alerts.js'
import { getScheduledPrompt, listScheduledPrompts } from '../../src/deferred-prompts/scheduled.js'
import {
  executeCancel,
  executeCreate,
  executeGet,
  executeList,
  executeUpdate,
} from '../../src/deferred-prompts/tool-handlers.js'
import type { CreateResult } from '../../src/deferred-prompts/types.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

function collectEvents(type: string): { events: DebugEvent[]; cleanup: () => void } {
  const events: DebugEvent[] = []
  const handler = (e: DebugEvent): void => {
    if (e.type === type) events.push(e)
  }
  subscribe(handler)
  return { events, cleanup: () => unsubscribe(handler) }
}

function expectCreatedPromptId(result: CreateResult): string {
  if ('id' in result) return result.id
  expect(result).toHaveProperty('id')
  return ''
}

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
      schedule: { rrule: { freq: 'DAILY', byHour: [9], byMinute: [0] } },
    })

    expect(result).not.toHaveProperty('error')
    assert.ok(typeof result === 'object')
    assert.ok(result !== null)
    assert.ok('fireAt' in result)
    // Returned fireAt is converted back to local time; must be 09:xx
    expect(result.fireAt).toContain('09:')
  })

  test('UTC user is unaffected', () => {
    setConfig(USER_ID, 'timezone', 'UTC')
    const result = executeCreate(USER_ID, {
      prompt: 'Daily',
      schedule: { rrule: { freq: 'DAILY', byHour: [9], byMinute: [0] } },
    })
    expect(result).not.toHaveProperty('error')
    assert.ok(typeof result === 'object')
    assert.ok(result !== null)
    assert.ok('fireAt' in result)
    expect(result.fireAt).toContain('09:')
  })

  test('legacy UTC offset config is normalized before fire_at conversion', () => {
    setCachedConfig(USER_ID, 'timezone', 'UTC+5')
    const result = executeCreate(USER_ID, {
      prompt: 'Morning reminder',
      schedule: { fire_at: { date: '2030-01-10', time: '09:00' } },
    })

    expect(result).not.toHaveProperty('error')
    assert.ok(typeof result === 'object')
    assert.ok(result !== null)
    assert.ok('fireAt' in result)
    expect(result.fireAt).toBe('2030-01-10T09:00:00')

    const { prompts } = executeList(USER_ID, { type: 'scheduled' })
    const prompt = prompts[0]!
    assert.ok(prompt.type === 'scheduled')
    expect(prompt.fireAt).toBe('2030-01-10T04:00:00.000Z')
  })
})

describe('executeCreate — group thread ownership', () => {
  const parentContextId = toScopedContextId({
    platformInstanceId: 'telegram-default',
    nativeContextId: 'group-1',
  })
  const threadContextId = toScopedThreadContextId({
    platformInstanceId: 'telegram-default',
    nativeContextId: 'group-1',
    threadId: '42',
  })
  const deliveryContext = {
    userId: 'chat-user-1',
    storageContextId: threadContextId,
    contextType: 'group' as const,
    username: 'alice',
  }

  test('thread-created scheduled prompt is owned by parent group and delivered to thread', () => {
    setConfig(parentContextId, 'timezone', 'UTC')

    const result = executeCreate(
      parentContextId,
      {
        prompt: 'post status',
        schedule: { fire_at: { date: '2099-01-01', time: '09:00' } },
        execution: { delivery_brief: 'status' },
      },
      deliveryContext,
    )

    expect(result).toMatchObject({ status: 'created', type: 'scheduled' })
    const createdId = expectCreatedPromptId(result)

    const prompts = listScheduledPrompts(parentContextId)
    expect(prompts).toHaveLength(1)
    expect(listScheduledPrompts(threadContextId)).toHaveLength(0)
    expect(prompts[0]!.createdByUserId).toBe(parentContextId)
    expect(prompts[0]!.deliveryTarget.storageContextId).toBe(threadContextId)

    const persisted = getScheduledPrompt(createdId, parentContextId)
    expect(persisted).toBeDefined()
    expect(persisted!.deliveryTarget.storageContextId).toBe(threadContextId)
  })

  test('thread-created alert prompt is owned by parent group and delivered to thread', () => {
    const result = executeCreate(
      parentContextId,
      {
        prompt: 'watch task status',
        condition: { field: 'task.status', op: 'changed_to', value: 'done' },
        execution: { delivery_brief: 'status changed' },
      },
      deliveryContext,
    )

    expect(result).toMatchObject({ status: 'created', type: 'alert' })
    const createdId = expectCreatedPromptId(result)

    const prompts = listAlertPrompts(parentContextId)
    expect(prompts).toHaveLength(1)
    expect(listAlertPrompts(threadContextId)).toHaveLength(0)
    expect(prompts[0]!.createdByUserId).toBe(parentContextId)
    expect(prompts[0]!.deliveryTarget.storageContextId).toBe(threadContextId)

    const persisted = getAlertPrompt(createdId, parentContextId)
    expect(persisted).toBeDefined()
    expect(persisted!.deliveryTarget.storageContextId).toBe(threadContextId)
  })
})

describe('executeUpdate — rrule timezone', () => {
  test('update rrule on existing prompt stores correct rrule string', () => {
    setConfig(USER_ID, 'timezone', 'Asia/Karachi')

    executeCreate(USER_ID, {
      prompt: 'Daily',
      schedule: { rrule: { freq: 'DAILY', byHour: [9], byMinute: [0] } },
    })
    const { prompts } = executeList(USER_ID, { type: 'scheduled' })
    expect(prompts).toHaveLength(1)
    const id = prompts[0]!.id

    const updated = executeUpdate(USER_ID, {
      id,
      schedule: { rrule: { freq: 'DAILY', byHour: [10], byMinute: [0] } },
    })
    expect(updated).not.toHaveProperty('error')
    assert.ok(typeof updated === 'object')
    assert.ok(updated !== null)
    assert.ok('rrule' in updated)
    expect(String(updated.rrule)).toBe('FREQ=DAILY;BYHOUR=10;BYMINUTE=0')
  })

  test('update rrule recomputes fireAt to reflect new rule immediately', () => {
    setConfig(USER_ID, 'timezone', 'UTC')

    executeCreate(USER_ID, {
      prompt: 'Daily',
      schedule: { rrule: { freq: 'DAILY', byHour: [9], byMinute: [0] } },
    })
    const { prompts: before } = executeList(USER_ID, { type: 'scheduled' })
    const existing = before[0]!
    assert.ok(existing.type === 'scheduled')
    const originalFireAt = existing.fireAt

    const updated = executeUpdate(USER_ID, {
      id: existing.id,
      schedule: { rrule: { freq: 'DAILY', byHour: [22], byMinute: [0] } },
    })
    expect(updated).not.toHaveProperty('error')
    assert.ok(typeof updated === 'object')
    assert.ok(updated !== null)
    assert.ok('fireAt' in updated)
    // fireAt must change to reflect the new rule immediately (not remain at the old 09:xx value)
    expect(updated.fireAt).not.toBe(originalFireAt)
    expect(updated.fireAt).toContain('T22:')
  })

  test('create with no byHour/byMinute anchors DTSTART at midnight of the rrule timezone', () => {
    setConfig(USER_ID, 'timezone', 'UTC')
    executeCreate(USER_ID, {
      prompt: 'Weekly on Monday',
      schedule: { rrule: { freq: 'WEEKLY', byDay: ['MO'] } },
    })
    const { prompts } = executeList(USER_ID, { type: 'scheduled' })
    expect(prompts).toHaveLength(1)
    const prompt = prompts[0]!
    assert.ok(prompt.type === 'scheduled')
    expect(prompt.dtstartUtc).toMatch(/T00:00:00\.000Z$/u)
  })

  test('update rrule preserves original dtstartUtc series anchor', () => {
    setConfig(USER_ID, 'timezone', 'UTC')

    executeCreate(USER_ID, {
      prompt: 'Daily',
      schedule: { rrule: { freq: 'DAILY', byHour: [9], byMinute: [0] } },
    })
    const { prompts: before } = executeList(USER_ID, { type: 'scheduled' })
    const existing = before[0]!
    assert.ok(existing.type === 'scheduled')
    const originalDtstartUtc = existing.dtstartUtc

    executeUpdate(USER_ID, {
      id: existing.id,
      schedule: { rrule: { freq: 'DAILY', byHour: [10], byMinute: [0] } },
    })
    const { prompts: after } = executeList(USER_ID, { type: 'scheduled' })
    const afterFirst = after[0]!
    assert.ok(afterFirst.type === 'scheduled')
    // dtstartUtc must equal the original series anchor, not the edit timestamp
    expect(afterFirst.dtstartUtc).toBe(originalDtstartUtc)
  })
})

describe('deferred lifecycle events', () => {
  test('executeCreate emits deferred:created with promptId', () => {
    setConfig(USER_ID, 'timezone', 'UTC')
    const { events, cleanup } = collectEvents('deferred:created')
    try {
      const result = executeCreate(USER_ID, {
        prompt: 'Test prompt',
        schedule: { rrule: { freq: 'DAILY', byHour: [9], byMinute: [0] } },
      })
      expect(result).not.toHaveProperty('error')
      expect(result).toHaveProperty('id')
      expect(events).toHaveLength(1)
      expect(events[0]!.data['promptId']).toBe(Reflect.get(result, 'id'))
      expect(events[0]!.scope).toEqual({ kind: 'user', userId: USER_ID })
    } finally {
      cleanup()
    }
  })

  test('executeUpdate emits deferred:updated with promptId', () => {
    setConfig(USER_ID, 'timezone', 'UTC')
    executeCreate(USER_ID, {
      prompt: 'Original',
      schedule: { rrule: { freq: 'DAILY', byHour: [9], byMinute: [0] } },
    })
    const { prompts } = executeList(USER_ID, { type: 'scheduled' })
    const id = prompts[0]!.id

    const { events, cleanup } = collectEvents('deferred:updated')
    try {
      executeUpdate(USER_ID, { id, prompt: 'Updated prompt' })
      expect(events).toHaveLength(1)
      expect(events[0]!.data['promptId']).toBe(id)
      expect(events[0]!.scope).toEqual({ kind: 'user', userId: USER_ID })
    } finally {
      cleanup()
    }
  })

  test('executeCancel emits deferred:cancelled with promptId', () => {
    setConfig(USER_ID, 'timezone', 'UTC')
    executeCreate(USER_ID, {
      prompt: 'Will cancel',
      schedule: { rrule: { freq: 'DAILY', byHour: [9], byMinute: [0] } },
    })
    const { prompts } = executeList(USER_ID, { type: 'scheduled' })
    const id = prompts[0]!.id

    const { events, cleanup } = collectEvents('deferred:cancelled')
    try {
      executeCancel(USER_ID, { id })
      expect(events).toHaveLength(1)
      expect(events[0]!.data['promptId']).toBe(id)
      expect(events[0]!.scope).toEqual({ kind: 'user', userId: USER_ID })
    } finally {
      cleanup()
    }
  })
})

describe('executeCreate — input guards', () => {
  test('rejects schedule and condition together', () => {
    const { events, cleanup } = collectEvents('deferred:created')
    try {
      const result = executeCreate(USER_ID, {
        prompt: 'both',
        schedule: { fire_at: { date: '2099-01-01', time: '09:00' } },
        condition: { field: 'task.status', op: 'changed_to', value: 'done' },
      })
      expect(result).toEqual({ error: 'Provide either a schedule or a condition, not both.' })
      expect(events).toHaveLength(0)
    } finally {
      cleanup()
    }
  })

  test('rejects missing schedule and condition', () => {
    const { events, cleanup } = collectEvents('deferred:created')
    try {
      const result = executeCreate(USER_ID, { prompt: 'neither' })
      expect(result).toEqual({
        error: 'Provide either a schedule (for time-based) or a condition (for event-based).',
      })
      expect(events).toHaveLength(0)
    } finally {
      cleanup()
    }
  })

  test('rejects empty schedule object', () => {
    setConfig(USER_ID, 'timezone', 'UTC')
    const result = executeCreate(USER_ID, { prompt: 'empty', schedule: {} })
    expect(result).toEqual({ error: 'Schedule must include either fire_at or rrule.' })
  })

  test('rejects past fire_at', () => {
    setConfig(USER_ID, 'timezone', 'UTC')
    const { events, cleanup } = collectEvents('deferred:created')
    try {
      const result = executeCreate(USER_ID, {
        prompt: 'past',
        schedule: { fire_at: { date: '2000-01-01', time: '00:00' } },
      })
      expect(result).toEqual({ error: 'fire_at must be a future date and time.' })
      expect(events).toHaveLength(0)
    } finally {
      cleanup()
    }
  })

  test('passes through invalid-timezone error', () => {
    setConfig(USER_ID, 'timezone', 'Not/AZone')
    const result = executeCreate(USER_ID, {
      prompt: 'tz',
      schedule: { fire_at: { date: '2099-01-01', time: '09:00' } },
    })
    expect(result).toEqual({
      error: 'Your configured timezone is invalid. Please update it in /config (settings web UI) and try again.',
    })
  })
})

describe('executeCreate — rrule edge cases', () => {
  test('explicit startDate/startTime anchor dtstartUtc, not midnight', () => {
    setConfig(USER_ID, 'timezone', 'UTC')
    executeCreate(USER_ID, {
      prompt: 'anchored',
      schedule: {
        rrule: { freq: 'DAILY', byHour: [9], byMinute: [0], startDate: '2030-03-15', startTime: '08:30' },
      },
    })
    const { prompts } = executeList(USER_ID, { type: 'scheduled' })
    expect(prompts).toHaveLength(1)
    const prompt = prompts[0]!
    assert.ok(prompt.type === 'scheduled')
    expect(prompt.dtstartUtc).toBe('2030-03-15T08:30:00.000Z')
  })

  test('rrule with until in the past has no next occurrence', () => {
    setConfig(USER_ID, 'timezone', 'UTC')
    const result = executeCreate(USER_ID, {
      prompt: 'expired',
      schedule: {
        rrule: { freq: 'DAILY', byHour: [9], byMinute: [0], until: '2000-01-01T00:00:00.000Z' },
      },
    })
    expect(result).toEqual({ error: 'Could not compute next occurrence for the given rrule spec.' })
  })
})

describe('executeCreate — alert validation and events', () => {
  test('rejects invalid condition and emits nothing', () => {
    const { events, cleanup } = collectEvents('deferred:created')
    try {
      const result = executeCreate(USER_ID, {
        prompt: 'bad condition',
        condition: { field: 'task.status', op: 'bogus_op', value: 'x' },
      })
      expect(result).toHaveProperty('error')
      assert.ok('error' in result)
      expect(result.error).toContain('Invalid condition:')
      expect(events).toHaveLength(0)
    } finally {
      cleanup()
    }
  })

  test('valid alert emits deferred:created with the alert id', () => {
    const { events, cleanup } = collectEvents('deferred:created')
    try {
      const result = executeCreate(USER_ID, {
        prompt: 'good condition',
        condition: { field: 'task.status', op: 'changed_to', value: 'done' },
      })
      expect(result).toMatchObject({ status: 'created', type: 'alert' })
      assert.ok('id' in result)
      expect(events).toHaveLength(1)
      expect(events[0]!.data['promptId']).toBe(result.id)
    } finally {
      cleanup()
    }
  })
})

describe('executeGet', () => {
  test('returns not-found for unknown id', () => {
    const result = executeGet(USER_ID, { id: 'does-not-exist' })
    expect(result).toEqual({ error: 'Reminder or alert not found.' })
  })

  test('returns the alert when the id belongs to an alert', () => {
    const created = executeCreate(USER_ID, {
      prompt: 'find me',
      condition: { field: 'task.status', op: 'changed_to', value: 'done' },
    })
    assert.ok('id' in created)
    const result = executeGet(USER_ID, { id: created.id })
    expect(result).toMatchObject({ type: 'alert', id: created.id, prompt: 'find me' })
  })
})

describe('executeUpdate — scheduled prompt fields', () => {
  const createDaily = (): string => {
    setConfig(USER_ID, 'timezone', 'UTC')
    executeCreate(USER_ID, {
      prompt: 'Original',
      schedule: { rrule: { freq: 'DAILY', byHour: [9], byMinute: [0] } },
    })
    const { prompts } = executeList(USER_ID, { type: 'scheduled' })
    return prompts[0]!.id
  }

  test('rejects a condition on a scheduled prompt and emits nothing', () => {
    const id = createDaily()
    const { events, cleanup } = collectEvents('deferred:updated')
    try {
      const result = executeUpdate(USER_ID, {
        id,
        condition: { field: 'task.status', op: 'changed_to', value: 'done' },
      })
      expect(result).toEqual({
        error: 'Cannot apply a condition to a scheduled prompt. Use schedule fields instead.',
      })
      expect(events).toHaveLength(0)
    } finally {
      cleanup()
    }
  })

  test('prompt-only update is persisted', () => {
    const id = createDaily()
    const result = executeUpdate(USER_ID, { id, prompt: 'Rewritten' })
    expect(result).toMatchObject({ status: 'updated', prompt: 'Rewritten' })
    expect(getScheduledPrompt(id, USER_ID)!.prompt).toBe('Rewritten')
  })

  test('valid execution replaces stored metadata', () => {
    const id = createDaily()
    const result = executeUpdate(USER_ID, {
      id,
      execution: { delivery_brief: 'new brief', context_snapshot: 'snap' },
    })
    expect(result).toMatchObject({ status: 'updated' })
    expect(getScheduledPrompt(id, USER_ID)!.executionMetadata).toEqual({
      delivery_brief: 'new brief',
      context_snapshot: 'snap',
    })
  })

  test('invalid execution is ignored and keeps previous metadata', () => {
    const id = createDaily()
    executeUpdate(USER_ID, { id, execution: { delivery_brief: 'kept brief' } })
    const invalidExecution = { delivery_brief: 'x', context_snapshot: 'no brief' }
    delete (invalidExecution as { delivery_brief?: string }).delivery_brief
    const result = executeUpdate(USER_ID, { id, execution: invalidExecution })
    expect(result).toMatchObject({ status: 'updated' })
    expect(getScheduledPrompt(id, USER_ID)!.executionMetadata.delivery_brief).toBe('kept brief')
  })
})

describe('executeUpdate — alert prompt fields', () => {
  const createAlert = (): string => {
    const result = executeCreate(USER_ID, {
      prompt: 'watch it',
      condition: { field: 'task.status', op: 'changed_to', value: 'done' },
    })
    assert.ok('id' in result)
    return result.id
  }

  test('rejects a schedule on an alert prompt and emits nothing', () => {
    const id = createAlert()
    const { events, cleanup } = collectEvents('deferred:updated')
    try {
      const result = executeUpdate(USER_ID, {
        id,
        schedule: { fire_at: { date: '2099-01-01', time: '09:00' } },
      })
      expect(result).toEqual({
        error: 'Cannot apply a schedule to an alert prompt. Use condition fields instead.',
      })
      expect(events).toHaveLength(0)
    } finally {
      cleanup()
    }
  })

  test('prompt update is persisted', () => {
    const id = createAlert()
    const result = executeUpdate(USER_ID, { id, prompt: 'watch harder' })
    expect(result).toMatchObject({ status: 'updated', prompt: 'watch harder' })
    expect(getAlertPrompt(id, USER_ID)!.prompt).toBe('watch harder')
  })

  test('valid condition update is persisted and emits deferred:updated', () => {
    const id = createAlert()
    const { events, cleanup } = collectEvents('deferred:updated')
    try {
      const condition = { field: 'task.labels', op: 'contains', value: 'bug' } as const
      const result = executeUpdate(USER_ID, { id, condition })
      expect(result).toMatchObject({ status: 'updated' })
      expect(getAlertPrompt(id, USER_ID)!.condition).toEqual(condition)
      expect(events).toHaveLength(1)
      expect(events[0]!.data['promptId']).toBe(id)
    } finally {
      cleanup()
    }
  })

  test('invalid condition update fails and emits nothing', () => {
    const id = createAlert()
    const { events, cleanup } = collectEvents('deferred:updated')
    try {
      const result = executeUpdate(USER_ID, {
        id,
        condition: { field: 'task.status', op: 'bogus_op', value: 'x' },
      })
      expect(result).toHaveProperty('error')
      assert.ok('error' in result)
      expect(result.error).toContain('Invalid condition:')
      expect(events).toHaveLength(0)
    } finally {
      cleanup()
    }
  })

  test('cooldown update is persisted', () => {
    const id = createAlert()
    const result = executeUpdate(USER_ID, { id, cooldown_minutes: 15 })
    expect(result).toMatchObject({ status: 'updated' })
    expect(getAlertPrompt(id, USER_ID)!.cooldownMinutes).toBe(15)
  })

  test('valid execution update is persisted; invalid execution is ignored', () => {
    const id = createAlert()
    executeUpdate(USER_ID, { id, execution: { delivery_brief: 'alert brief' } })
    expect(getAlertPrompt(id, USER_ID)!.executionMetadata.delivery_brief).toBe('alert brief')

    // Widen + delete: lint-safe way to feed a payload missing delivery_brief
    // (oxlint no-unsafe-type-assertion blocks `as unknown as` narrowing casts).
    const invalidExecution = { delivery_brief: 'x', context_snapshot: 'no brief' }
    delete (invalidExecution as { delivery_brief?: string }).delivery_brief
    const result = executeUpdate(USER_ID, { id, execution: invalidExecution })
    expect(result).toMatchObject({ status: 'updated' })
    expect(getAlertPrompt(id, USER_ID)!.executionMetadata.delivery_brief).toBe('alert brief')
  })

  test('returns not-found for unknown id', () => {
    const result = executeUpdate(USER_ID, { id: 'does-not-exist', prompt: 'x' })
    expect(result).toEqual({ error: 'Reminder or alert not found.' })
  })
})

describe('executeCancel — alerts and unknown ids', () => {
  test('cancels an alert and emits deferred:cancelled', () => {
    const created = executeCreate(USER_ID, {
      prompt: 'alert to cancel',
      condition: { field: 'task.status', op: 'changed_to', value: 'done' },
    })
    assert.ok('id' in created)

    const { events, cleanup } = collectEvents('deferred:cancelled')
    try {
      const result = executeCancel(USER_ID, { id: created.id })
      expect(result).toEqual({ status: 'cancelled', id: created.id })
      expect(getAlertPrompt(created.id, USER_ID)!.status).toBe('cancelled')
      expect(events).toHaveLength(1)
      expect(events[0]!.data['promptId']).toBe(created.id)
    } finally {
      cleanup()
    }
  })

  test('returns not-found for unknown id and emits nothing', () => {
    const { events, cleanup } = collectEvents('deferred:cancelled')
    try {
      const result = executeCancel(USER_ID, { id: 'does-not-exist' })
      expect(result).toEqual({ error: 'Reminder or alert not found.' })
      expect(events).toHaveLength(0)
    } finally {
      cleanup()
    }
  })
})
