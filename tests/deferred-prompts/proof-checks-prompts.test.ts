// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import {
  appendRecord,
  createProofPrompt,
  fireAtLeadFor,
  makeRecord,
  minuteFloorMs,
  proofMarker,
  proofMarkerSentence,
  resolveLocale,
  resolveTimezone,
  resolveWindowMs,
  sweepProofPrompts,
} from '../../src/deferred-prompts/proof-checks-prompts.js'
import type { ProofCheckDeps, ProofCheckRequest } from '../../src/deferred-prompts/proof-checks.js'
import type { ProofCheckRecord } from '../../src/deferred-prompts/proof-store.js'
import type {
  AlertCondition,
  AlertPrompt,
  CancelResult,
  CreateResult,
  ScheduledPrompt,
} from '../../src/deferred-prompts/types.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const CLOCK_BASE_MS = 1_700_000_040_000
const MINUTE_MS = 60_000
const OWNER = 'sc-admin'
const MARKER_PREFIX = '[[proof-check:'

const makeRequest = (overrides: Partial<ProofCheckRequest> = {}): ProofCheckRequest => ({
  storageContextId: OWNER,
  chatUserId: 'chat-admin',
  ...overrides,
})

const baseDeps = (): ProofCheckDeps => ({
  now: () => CLOCK_BASE_MS,
  setTimeout: () => 0,
  clearTimeout: () => undefined,
  subscribe: () => undefined,
  unsubscribe: () => undefined,
  executeCreate: (): CreateResult => ({ error: 'unused' }),
  executeUpdate: () => ({ error: 'unused' }),
  executeGet: () => ({ error: 'unused' }),
  executeCancel: (): CancelResult => ({ error: 'unused' }),
  listScheduledPrompts: () => [],
  listAlertPrompts: () => [],
  getScheduledPrompt: () => null,
  getAlertPrompt: () => null,
  store: { append: () => Promise.resolve(), load: () => Promise.resolve([]) },
  readRecentLlm: () => [],
  readCachedHistory: () => [],
})

const deliveryTargetFor = (ownerId: string): ScheduledPrompt['deliveryTarget'] => ({
  contextId: ownerId,
  contextType: 'dm',
  threadId: null,
  audience: 'personal',
  mentionUserIds: [],
  createdByUserId: ownerId,
  createdByUsername: null,
  storageContextId: ownerId,
})

const TEST_CONDITION: AlertCondition = { field: 'task.status', op: 'eq', value: 'open' }

const makeScheduledRow = (
  id: string,
  ownerId: string,
  prompt: string,
  status: ScheduledPrompt['status'] = 'active',
): ScheduledPrompt => ({
  type: 'scheduled',
  id,
  createdByUserId: ownerId,
  createdByUsername: null,
  deliveryTarget: deliveryTargetFor(ownerId),
  prompt,
  fireAt: new Date(CLOCK_BASE_MS).toISOString(),
  rrule: null,
  dtstartUtc: null,
  timezone: null,
  status,
  createdAt: new Date(CLOCK_BASE_MS).toISOString(),
  lastExecutedAt: null,
  executionMetadata: { delivery_brief: '', context_snapshot: null },
})

const makeAlertRow = (id: string, ownerId: string, prompt: string): AlertPrompt => ({
  type: 'alert',
  id,
  createdByUserId: ownerId,
  createdByUsername: null,
  deliveryTarget: deliveryTargetFor(ownerId),
  prompt,
  condition: TEST_CONDITION,
  status: 'active',
  createdAt: new Date(CLOCK_BASE_MS).toISOString(),
  lastTriggeredAt: null,
  lastActivityCursor: null,
  cooldownMinutes: 60,
  executionMetadata: { delivery_brief: '', context_snapshot: null },
  matchedTaskIds: [],
  taskInstanceId: null,
})

describe('proof check prompt helpers', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('marker helpers produce the reserved [[proof-check:<runId>]] token and an embedding sentence', () => {
    expect(proofMarker('run-1')).toBe(`${MARKER_PREFIX}run-1]]`)
    const sentence = proofMarkerSentence('run-1')
    expect(sentence).toContain('run-1')
    expect(sentence).toContain(proofMarker('run-1'))
  })

  test('minuteFloorMs floors to whole minutes and fireAtLeadFor pins the bug3 lead', () => {
    expect(minuteFloorMs(CLOCK_BASE_MS + 1_000)).toBe(CLOCK_BASE_MS)
    expect(minuteFloorMs(CLOCK_BASE_MS - 1_000)).toBe(CLOCK_BASE_MS - MINUTE_MS)
    expect(fireAtLeadFor('bug3_fires_on_creation')).toBe(10 * MINUTE_MS)
    expect(fireAtLeadFor('bug2_context_time')).toBe(90_000)
    expect(fireAtLeadFor('bug5_update_preserves_prompt')).toBe(90_000)
  })

  test('window defaults to two poll intervals, doubles for the alert variant, and clamps wait_seconds', () => {
    expect(resolveWindowMs(makeRequest(), false)).toBe(2 * 60_000)
    expect(resolveWindowMs(makeRequest(), true)).toBe(2 * 5 * MINUTE_MS)
    expect(resolveWindowMs(makeRequest({ wait_seconds: 30 }), false)).toBe(30_000)
    expect(resolveWindowMs(makeRequest({ wait_seconds: 20 * MINUTE_MS }), false)).toBe(15 * MINUTE_MS)
    expect(resolveWindowMs(makeRequest({ wait_seconds: 0 }), false)).toBe(1_000)
  })

  test('resolveTimezone and resolveLocale fall back to UTC and en without a stored config', () => {
    expect(resolveTimezone(OWNER)).toBe('UTC')
    expect(resolveLocale(OWNER)).toBe('en')
  })

  test('makeRecord carries the record shape and omits an undefined variant', () => {
    const withVariant = makeRecord('run-1', 'bug2_context_time', 'default', CLOCK_BASE_MS, CLOCK_BASE_MS + 5, 'fail', [
      'observation',
    ])
    expect(withVariant).toEqual({
      run_id: 'run-1',
      check: 'bug2_context_time',
      variant: 'default',
      started_at: new Date(CLOCK_BASE_MS).toISOString(),
      finished_at: new Date(CLOCK_BASE_MS + 5).toISOString(),
      verdict: 'fail',
      observations: ['observation'],
    })
    const withoutVariant = makeRecord(
      'run-2',
      'bug4_create_response_mode',
      undefined,
      CLOCK_BASE_MS,
      CLOCK_BASE_MS,
      'pass',
      [],
    )
    expect('variant' in withoutVariant).toBe(false)
    expect(withoutVariant.run_id).toBe('run-2')
  })

  test('appendRecord stores the record and swallows store failures', async () => {
    const stored: ProofCheckRecord[] = []
    const deps = baseDeps()
    deps.store = {
      append: (record: ProofCheckRecord): Promise<void> => {
        stored.push(record)
        return Promise.resolve()
      },
      load: (): Promise<ProofCheckRecord[]> => Promise.resolve([]),
    }
    const record = makeRecord('run-1', 'bug4_create_response_mode', undefined, CLOCK_BASE_MS, CLOCK_BASE_MS, 'pass', [])
    await appendRecord(deps, record)
    expect(stored).toEqual([record])

    let attempts = 0
    deps.store = {
      append: (): Promise<void> => {
        attempts += 1
        return Promise.reject(new Error('disk exploded'))
      },
      load: (): Promise<ProofCheckRecord[]> => Promise.resolve([]),
    }
    await appendRecord(deps, record)
    expect(attempts).toBe(1)
  })

  test('sweepProofPrompts cancels only active marker prompts owned by the requester', () => {
    const scheduled = new Map<string, ScheduledPrompt>([
      ['sp-mine', makeScheduledRow('sp-mine', OWNER, `${MARKER_PREFIX}a]] leftover`)],
      ['sp-plain', makeScheduledRow('sp-plain', OWNER, 'plain reminder')],
      ['sp-done', makeScheduledRow('sp-done', OWNER, `${MARKER_PREFIX}b]] old`, 'cancelled')],
      ['sp-foreign', makeScheduledRow('sp-foreign', 'sc-other', `${MARKER_PREFIX}c]] foreign`)],
    ])
    const alerts = new Map<string, AlertPrompt>([
      ['al-mine', makeAlertRow('al-mine', OWNER, `${MARKER_PREFIX}d]] alert`)],
    ])
    const cancelled: string[] = []
    const deps = baseDeps()
    deps.listScheduledPrompts = (): ScheduledPrompt[] => [...scheduled.values()]
    deps.listAlertPrompts = (): AlertPrompt[] => [...alerts.values()]
    deps.executeCancel = (_userId: string, input: { id: string }): CancelResult => {
      cancelled.push(input.id)
      return { status: 'cancelled', id: input.id }
    }

    expect(sweepProofPrompts(deps, OWNER)).toEqual(['sp-mine', 'al-mine'])
    expect(cancelled).toEqual(['sp-mine', 'al-mine'])
  })

  test('createProofPrompt binds the admin ids, prefixes the marker, and derives the UTC fire_at', () => {
    const calls: Array<{ userId: string; prompt: string; deliveryCtx: unknown; fireAt: unknown }> = []
    const deps = baseDeps()
    deps.executeCreate = (
      userId: string,
      input: { prompt: string; schedule?: { fire_at?: unknown } },
      deliveryCtx: unknown,
    ): CreateResult => {
      calls.push({ userId, prompt: input.prompt, deliveryCtx, fireAt: input.schedule?.fire_at })
      return { status: 'created', type: 'scheduled', id: 'sp-1', fireAt: 'x', rrule: null }
    }

    const fireAtMs = Date.UTC(2026, 0, 2, 3, 4, 0)
    const created = createProofPrompt(deps, makeRequest(), 'run-1', fireAtMs, undefined)

    expect(calls[0]?.userId).toBe(OWNER)
    expect(calls[0]?.deliveryCtx).toEqual({ userId: 'chat-admin', storageContextId: OWNER, contextType: 'dm' })
    expect(created.input.prompt.startsWith(proofMarker('run-1'))).toBe(true)
    expect(created.result).toMatchObject({ status: 'created', id: 'sp-1' })
    expect(created.input.schedule?.fire_at).toEqual({ date: '2026-01-02', time: '03:04' })
    expect(created.input.execution?.delivery_brief).toContain(proofMarkerSentence('run-1'))
  })

  test('createProofPrompt alert variant carries a never-matching condition and no schedule', () => {
    let condition: unknown
    const deps = baseDeps()
    deps.executeCreate = (_userId: string, input: { condition?: unknown }): CreateResult => {
      condition = input.condition
      return { status: 'created', type: 'alert', id: 'al-1', cooldownMinutes: 60 }
    }

    const created = createProofPrompt(deps, makeRequest({ variant: 'alert' }), 'run-1', null, 'alert')

    expect(created.result).toMatchObject({ status: 'created', type: 'alert', id: 'al-1' })
    expect(condition).toMatchObject({ field: 'task.status', op: 'neq', value: '__proof_check_never__' })
    expect(created.input.schedule).toBeUndefined()
  })

  test('the tool-probe brief instructs one failing web_fetch against the loopback probe URL', () => {
    let brief: string | undefined
    const deps = baseDeps()
    deps.executeCreate = (_userId: string, input: { execution?: { delivery_brief?: string } }): CreateResult => {
      brief = input.execution?.delivery_brief
      return { status: 'created', type: 'scheduled', id: 'sp-1', fireAt: 'x', rrule: null }
    }

    createProofPrompt(deps, makeRequest({ variant: 'with_tool_probe' }), 'run-1', null, 'with_tool_probe')

    expect(brief).toContain(proofMarkerSentence('run-1'))
    expect(brief).toContain('web_fetch')
    expect(brief).toContain('http://127.0.0.1:9/proof-check-probe')
  })
})
