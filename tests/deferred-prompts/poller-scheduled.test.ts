// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { finalizeAllPrompts, mergeExecutionMetadata } from '../../src/deferred-prompts/poller-scheduled.js'
import type { ExecutionMetadata, ScheduledPrompt } from '../../src/deferred-prompts/types.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const USER_ID = 'poller-sched-user'

function makePrompt(overrides: Partial<ScheduledPrompt> = {}): ScheduledPrompt {
  return {
    type: 'scheduled',
    id: crypto.randomUUID(),
    createdByUserId: USER_ID,
    createdByUsername: null,
    deliveryTarget: {
      contextId: USER_ID,
      contextType: 'dm',
      threadId: null,
      audience: 'personal',
      mentionUserIds: [USER_ID],
      createdByUserId: USER_ID,
      createdByUsername: null,
    },
    prompt: 'test',
    fireAt: new Date(Date.now() - 60_000).toISOString(),
    rrule: null,
    dtstartUtc: null,
    timezone: null,
    status: 'active',
    createdAt: new Date().toISOString(),
    lastExecutedAt: null,
    executionMetadata: { mode: 'lightweight', delivery_brief: '', context_snapshot: null },
    ...overrides,
  }
}

beforeEach(() => {
  mockLogger()
})

describe('mergeExecutionMetadata', () => {
  test('uses highest-priority mode across prompts', () => {
    const prompts = [
      makePrompt({
        executionMetadata: { mode: 'lightweight', delivery_brief: '', context_snapshot: null },
      }),
      makePrompt({
        executionMetadata: { mode: 'full', delivery_brief: '', context_snapshot: null },
      }),
      makePrompt({
        executionMetadata: { mode: 'context', delivery_brief: '', context_snapshot: null },
      }),
    ]
    const result = mergeExecutionMetadata(prompts)
    expect(result.mode).toBe('full')
  })

  test('concatenates non-empty delivery briefs', () => {
    const prompts = [
      makePrompt({
        executionMetadata: { mode: 'lightweight', delivery_brief: 'alpha', context_snapshot: null },
      }),
      makePrompt({
        executionMetadata: { mode: 'lightweight', delivery_brief: '', context_snapshot: null },
      }),
      makePrompt({
        executionMetadata: { mode: 'lightweight', delivery_brief: 'beta', context_snapshot: null },
      }),
    ]
    const result = mergeExecutionMetadata(prompts)
    expect(result.delivery_brief).toBe('alpha\n---\nbeta')
  })

  test('returns empty brief when all are empty', () => {
    const prompts = [makePrompt(), makePrompt()]
    const result = mergeExecutionMetadata(prompts)
    expect(result.delivery_brief).toBe('')
  })

  test('single prompt returns its own metadata unchanged', () => {
    const meta: ExecutionMetadata = {
      mode: 'context',
      delivery_brief: 'brief',
      context_snapshot: 'snap',
    }
    const result = mergeExecutionMetadata([makePrompt({ executionMetadata: meta })])
    expect(result).toEqual(meta)
  })
})

describe('finalizeAllPrompts', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('completes a one-shot prompt', async () => {
    const { createScheduledPrompt, getScheduledPrompt } = await import('../../src/deferred-prompts/scheduled.js')
    const fireAt = new Date(Date.now() - 60_000).toISOString()
    const created = createScheduledPrompt(USER_ID, 'one-shot', { fireAt })

    finalizeAllPrompts([created], new Date().toISOString(), 'UTC')

    const after = getScheduledPrompt(created.id, USER_ID)
    expect(after!.status).toBe('completed')
  })

  test('advances a recurring prompt', async () => {
    const { createScheduledPrompt, getScheduledPrompt } = await import('../../src/deferred-prompts/scheduled.js')
    const fireAt = new Date(Date.now() - 60_000).toISOString()
    const created = createScheduledPrompt(USER_ID, 'recurring', {
      fireAt,
      cronCompiled: {
        rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0',
        dtstartUtc: fireAt,
        timezone: 'America/New_York',
      },
    })

    finalizeAllPrompts([created], new Date().toISOString(), 'UTC')

    const after = getScheduledPrompt(created.id, USER_ID)
    expect(after!.status).toBe('active')
    expect(new Date(after!.fireAt).getTime()).toBeGreaterThan(Date.now())
  })

  test('uses stored timezone for next occurrence, not the fallback', async () => {
    const recurrenceModule = await import('../../src/recurrence.js')
    const nextOccurrenceSpy = mock(recurrenceModule.nextOccurrence)
    void mock.module('../../src/recurrence.js', () => ({
      ...recurrenceModule,
      nextOccurrence: nextOccurrenceSpy,
    }))

    const { createScheduledPrompt } = await import('../../src/deferred-prompts/scheduled.js')
    const { finalizeAllPrompts: finalizeWithMock } = await import('../../src/deferred-prompts/poller-scheduled.js')

    const fireAt = new Date(Date.now() - 60_000).toISOString()
    const created = createScheduledPrompt(USER_ID, 'tz-test', {
      fireAt,
      cronCompiled: {
        rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0',
        dtstartUtc: fireAt,
        timezone: 'America/New_York',
      },
    })

    finalizeWithMock([created], new Date().toISOString(), 'Europe/Berlin')

    expect(nextOccurrenceSpy).toHaveBeenCalledTimes(1)
    expect(nextOccurrenceSpy.mock.calls[0]![0].timezone).toBe('America/New_York')
  })

  test('falls back to passed timezone when stored timezone is null', async () => {
    const recurrenceModule = await import('../../src/recurrence.js')
    const nextOccurrenceSpy = mock(recurrenceModule.nextOccurrence)
    void mock.module('../../src/recurrence.js', () => ({
      ...recurrenceModule,
      nextOccurrence: nextOccurrenceSpy,
    }))

    const { createScheduledPrompt } = await import('../../src/deferred-prompts/scheduled.js')
    const { finalizeAllPrompts: finalizeWithMock } = await import('../../src/deferred-prompts/poller-scheduled.js')

    const fireAt = new Date(Date.now() - 60_000).toISOString()
    const created = createScheduledPrompt(USER_ID, 'no-tz', {
      fireAt,
      cronCompiled: {
        rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0',
        dtstartUtc: fireAt,
      },
    })

    finalizeWithMock([created], new Date().toISOString(), 'Europe/Berlin')

    expect(nextOccurrenceSpy).toHaveBeenCalledTimes(1)
    expect(nextOccurrenceSpy.mock.calls[0]![0].timezone).toBe('Europe/Berlin')
  })
})
