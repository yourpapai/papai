// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import {
  advanceScheduledPrompt,
  cancelScheduledPrompt,
  completeScheduledPrompt,
  createScheduledPrompt,
  getScheduledPrompt,
  getScheduledPromptsDue,
  listScheduledPrompts,
  updateScheduledPrompt,
} from '../../src/deferred-prompts/scheduled.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const USER_ID = 'user-1'
const OTHER_USER = 'user-2'

beforeEach(() => {
  mockLogger()
})

describe('createScheduledPrompt', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('creates a one-shot prompt', () => {
    const fireAt = new Date(Date.now() + 60_000).toISOString()
    const prompt = createScheduledPrompt(USER_ID, 'Remind me to check tasks', { fireAt })

    expect(prompt.type).toBe('scheduled')
    expect(prompt.id).toBeDefined()
    expect(prompt.createdByUserId).toBe(USER_ID)
    expect(prompt.prompt).toBe('Remind me to check tasks')
    expect(prompt.fireAt).toBe(fireAt)
    expect(prompt.rrule).toBeNull()
    expect(prompt.status).toBe('active')
    expect(prompt.createdAt).toBeDefined()
    expect(prompt.lastExecutedAt).toBeNull()
  })

  test('creates a recurring prompt with cron expression', () => {
    const fireAt = new Date(Date.now() + 60_000).toISOString()
    const prompt = createScheduledPrompt(USER_ID, 'Daily standup summary', {
      fireAt,
      cronCompiled: { rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0', dtstartUtc: fireAt },
    })

    expect(prompt.type).toBe('scheduled')
    expect(prompt.rrule).toBe('FREQ=DAILY;BYHOUR=9;BYMINUTE=0')
    expect(prompt.status).toBe('active')
  })

  test('persists timezone from cronCompiled', () => {
    const fireAt = new Date(Date.now() + 60_000).toISOString()
    const prompt = createScheduledPrompt(USER_ID, 'Morning report', {
      fireAt,
      cronCompiled: {
        rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0',
        dtstartUtc: fireAt,
        timezone: 'America/New_York',
      },
    })

    expect(prompt.timezone).toBe('America/New_York')
  })

  test('stores null timezone when cronCompiled has no timezone', () => {
    const fireAt = new Date(Date.now() + 60_000).toISOString()
    const prompt = createScheduledPrompt(USER_ID, 'Legacy prompt', {
      fireAt,
      cronCompiled: { rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0', dtstartUtc: fireAt },
    })

    expect(prompt.timezone).toBeNull()
  })

  test('stores null timezone for one-shot prompts', () => {
    const fireAt = new Date(Date.now() + 60_000).toISOString()
    const prompt = createScheduledPrompt(USER_ID, 'One-shot', { fireAt })

    expect(prompt.timezone).toBeNull()
  })
})

describe('listScheduledPrompts', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('lists prompts for a user and excludes other users', () => {
    const fireAt = new Date(Date.now() + 60_000).toISOString()
    createScheduledPrompt(USER_ID, 'User 1 prompt A', { fireAt })
    createScheduledPrompt(USER_ID, 'User 1 prompt B', { fireAt })
    createScheduledPrompt(OTHER_USER, 'User 2 prompt', { fireAt })

    const prompts = listScheduledPrompts(USER_ID)
    expect(prompts).toHaveLength(2)
    expect(prompts.every((p) => p.createdByUserId === USER_ID)).toBe(true)
  })

  test('filters by status', () => {
    const fireAt = new Date(Date.now() + 60_000).toISOString()
    const p1 = createScheduledPrompt(USER_ID, 'Active prompt', { fireAt })
    createScheduledPrompt(USER_ID, 'Another active', { fireAt })
    cancelScheduledPrompt(p1.id, USER_ID)

    const activeOnly = listScheduledPrompts(USER_ID, 'active')
    expect(activeOnly).toHaveLength(1)
    expect(activeOnly[0]!.prompt).toBe('Another active')

    const cancelledOnly = listScheduledPrompts(USER_ID, 'cancelled')
    expect(cancelledOnly).toHaveLength(1)
    expect(cancelledOnly[0]!.prompt).toBe('Active prompt')
  })
})

describe('getScheduledPrompt', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('gets a prompt by id', () => {
    const fireAt = new Date(Date.now() + 60_000).toISOString()
    const created = createScheduledPrompt(USER_ID, 'Test prompt', { fireAt })

    const found = getScheduledPrompt(created.id, USER_ID)
    expect(found).not.toBeNull()
    expect(found!.id).toBe(created.id)
    expect(found!.prompt).toBe('Test prompt')
  })

  test('returns null for wrong user', () => {
    const fireAt = new Date(Date.now() + 60_000).toISOString()
    const created = createScheduledPrompt(USER_ID, 'Private prompt', { fireAt })

    const found = getScheduledPrompt(created.id, OTHER_USER)
    expect(found).toBeNull()
  })
})

describe('updateScheduledPrompt', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('updates prompt text', () => {
    const fireAt = new Date(Date.now() + 60_000).toISOString()
    const created = createScheduledPrompt(USER_ID, 'Old text', { fireAt })

    const updated = updateScheduledPrompt(created.id, USER_ID, { prompt: 'New text' })
    expect(updated).not.toBeNull()
    expect(updated!.prompt).toBe('New text')
  })

  test('returns null for non-existent prompt', () => {
    const result = updateScheduledPrompt('nonexistent-id', USER_ID, { prompt: 'X' })
    expect(result).toBeNull()
  })

  test('persists timezone when updating rrule', () => {
    const fireAt = new Date(Date.now() + 60_000).toISOString()
    const created = createScheduledPrompt(USER_ID, 'Old text', { fireAt })

    const updated = updateScheduledPrompt(created.id, USER_ID, {
      rrule: 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0',
      dtstartUtc: fireAt,
      timezone: 'Asia/Tokyo',
    })
    expect(updated).not.toBeNull()
    expect(updated!.timezone).toBe('Asia/Tokyo')
  })
})

describe('cancelScheduledPrompt', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('sets status to cancelled', () => {
    const fireAt = new Date(Date.now() + 60_000).toISOString()
    const created = createScheduledPrompt(USER_ID, 'Cancel me', { fireAt })

    const cancelled = cancelScheduledPrompt(created.id, USER_ID)
    expect(cancelled).not.toBeNull()
    expect(cancelled!.status).toBe('cancelled')
  })

  test('returns null for wrong user', () => {
    const fireAt = new Date(Date.now() + 60_000).toISOString()
    const created = createScheduledPrompt(USER_ID, 'Cancel me', { fireAt })

    const result = cancelScheduledPrompt(created.id, OTHER_USER)
    expect(result).toBeNull()
  })
})

describe('getScheduledPromptsDue', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('returns only prompts with fire_at in the past', () => {
    const pastTime = new Date(Date.now() - 60_000).toISOString()
    const futureTime = new Date(Date.now() + 3_600_000).toISOString()

    createScheduledPrompt(USER_ID, 'Past prompt', { fireAt: pastTime })
    createScheduledPrompt(USER_ID, 'Future prompt', { fireAt: futureTime })

    const due = getScheduledPromptsDue()
    expect(due).toHaveLength(1)
    expect(due[0]!.prompt).toBe('Past prompt')
  })

  test('does not return cancelled prompts', () => {
    const pastTime = new Date(Date.now() - 60_000).toISOString()
    const created = createScheduledPrompt(USER_ID, 'Cancelled past', { fireAt: pastTime })
    cancelScheduledPrompt(created.id, USER_ID)

    const due = getScheduledPromptsDue()
    expect(due).toHaveLength(0)
  })
})

describe('advanceScheduledPrompt', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('updates fire_at and last_executed_at for recurring prompt', () => {
    const fireAt = new Date(Date.now() - 60_000).toISOString()
    const created = createScheduledPrompt(USER_ID, 'Recurring', {
      fireAt,
      cronCompiled: { rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0', dtstartUtc: fireAt },
    })

    const nextFireAt = new Date(Date.now() + 86_400_000).toISOString()
    const executedAt = new Date().toISOString()
    advanceScheduledPrompt(created.id, USER_ID, nextFireAt, executedAt)

    const updated = getScheduledPrompt(created.id, USER_ID)
    expect(updated).not.toBeNull()
    expect(updated!.fireAt).toBe(nextFireAt)
    expect(updated!.lastExecutedAt).toBe(executedAt)
    expect(updated!.status).toBe('active')
  })
})

describe('completeScheduledPrompt', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('sets status to completed and last_executed_at', () => {
    const fireAt = new Date(Date.now() - 60_000).toISOString()
    const created = createScheduledPrompt(USER_ID, 'One-shot', { fireAt })

    const executedAt = new Date().toISOString()
    completeScheduledPrompt(created.id, USER_ID, executedAt)

    const updated = getScheduledPrompt(created.id, USER_ID)
    expect(updated).not.toBeNull()
    expect(updated!.status).toBe('completed')
    expect(updated!.lastExecutedAt).toBe(executedAt)
  })
})

describe('delivery target persistence', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('creates scheduled prompt with explicit creator and delivery target', () => {
    const fireAt = new Date(Date.now() + 60_000).toISOString()
    const prompt = createScheduledPrompt('user-1', 'remind me', { fireAt }, undefined, {
      contextId: '-1001',
      contextType: 'group',
      threadId: '42',
      audience: 'personal',
      mentionUserIds: ['user-1'],
      createdByUserId: 'user-1',
      createdByUsername: 'ki',
    })

    expect(prompt.createdByUserId).toBe('user-1')
    expect(prompt.createdByUsername).toBe('ki')
    expect(prompt.deliveryTarget.contextId).toBe('-1001')
    expect(prompt.deliveryTarget.threadId).toBe('42')
    expect(prompt.deliveryTarget.audience).toBe('personal')
    expect(prompt.deliveryTarget.mentionUserIds).toEqual(['user-1'])
  })

  test('lists scheduled prompts by creator identity after schema rename', () => {
    const fireAt = new Date(Date.now() + 60_000).toISOString()
    createScheduledPrompt('user-1', 'mine', { fireAt }, undefined, {
      contextId: '-1001',
      contextType: 'group',
      threadId: null,
      audience: 'shared',
      mentionUserIds: [],
      createdByUserId: 'user-1',
      createdByUsername: null,
    })
    createScheduledPrompt('user-2', 'not mine', { fireAt }, undefined, {
      contextId: '-1001',
      contextType: 'group',
      threadId: null,
      audience: 'shared',
      mentionUserIds: [],
      createdByUserId: 'user-2',
      createdByUsername: null,
    })

    const prompts = listScheduledPrompts('user-1')
    expect(prompts).toHaveLength(1)
    expect(prompts[0]!.createdByUserId).toBe('user-1')
  })

  test('defaults to dm delivery when no delivery provided', () => {
    const fireAt = new Date(Date.now() + 60_000).toISOString()
    const prompt = createScheduledPrompt(USER_ID, 'default delivery', { fireAt })

    expect(prompt.deliveryTarget.contextType).toBe('dm')
    expect(prompt.deliveryTarget.contextId).toBe(USER_ID)
    expect(prompt.deliveryTarget.audience).toBe('personal')
  })
})
