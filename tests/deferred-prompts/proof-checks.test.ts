// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, spyOn, test, type Mock } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ModelMessage } from 'ai'

import type { ChatProvider, DeferredDeliveryTarget } from '../../src/chat/types.js'
import { setConfig } from '../../src/config.testing.js'
import type { DebugEvent } from '../../src/debug/event-bus.js'
import type { LlmTrace } from '../../src/debug/llm-trace-collector.js'
import type { CreateDeliveryContext } from '../../src/deferred-prompts/delivery-input.js'
import { pollScheduledOnce } from '../../src/deferred-prompts/poller.js'
import * as proactiveLlmModule from '../../src/deferred-prompts/proactive-llm.js'
import * as proofChecksObserve from '../../src/deferred-prompts/proof-checks-observe.js'
import {
  PROOF_CHECKS,
  proofMarker,
  type ProofCheckDeps,
  type ProofCheckOutcome,
  type ProofCheckRequest,
  recordProofDelivery,
  resetProofChecksForTest,
  runProofCheck,
} from '../../src/deferred-prompts/proof-checks.js'
import type { ProofCheckRecord } from '../../src/deferred-prompts/proof-store.js'
import { createScheduledPrompt } from '../../src/deferred-prompts/scheduled.js'
import type { CreateInput, UpdateInput } from '../../src/deferred-prompts/tool-handlers.js'
import type {
  AlertCondition,
  AlertPrompt,
  CancelResult,
  CreateResult,
  GetResult,
  ScheduledPrompt,
  UpdateResult,
} from '../../src/deferred-prompts/types.js'
import { t } from '../../src/i18n/index.js'
import { setContextSettings } from '../../src/instances/context-store.js'
import { formatCurrentTimeTag } from '../../src/utils/current-time-format.js'
import { localDatetimeToUtc } from '../../src/utils/datetime.js'
import { createMockProvider } from '../tools/mock-provider.js'
import {
  createMockChatWithSentMessages,
  flushMicrotasks,
  mockLogger,
  seedAdminLlmBinding,
  seedCommonTestPlatformInstances,
  seedTestPlatformInstance,
  seedTestTaskInstance,
  setupTestDb,
  waitFor,
} from '../utils/test-helpers.js'

const CLOCK_BASE_MS = 1_700_000_040_000
const MINUTE_MS = 60_000
const SCHEDULED_POLL_MS = 60_000
const ALERT_POLL_MS = 5 * MINUTE_MS
const WINDOW_CAP_MS = 15 * MINUTE_MS
const DRAIN_ADVANCE_MS = WINDOW_CAP_MS + MINUTE_MS
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u

const ADMIN_STORAGE_ID = 'sc-admin'
const ADMIN_CHAT_ID = 'chat-admin'
const OTHER_STORAGE_ID = 'sc-other'
const MARKER_PREFIX = '[[proof-check:'

const TEST_CONDITION: AlertCondition = { field: 'task.status', op: 'eq', value: 'open' }

const minuteFloorMs = (ms: number): number => Math.floor(ms / MINUTE_MS) * MINUTE_MS

class FakeTimers {
  nowMs = CLOCK_BASE_MS
  delays: number[] = []
  private seq = 0
  private readonly entries = new Map<unknown, { fn: () => void; at: number; cleared: boolean }>()

  setTimeout = (fn: () => void, ms: number): unknown => {
    const id = ++this.seq
    this.delays.push(ms)
    this.entries.set(id, { fn, at: this.nowMs + ms, cleared: false })
    return id
  }

  clearTimeout = (handle: unknown): void => {
    const entry = this.entries.get(handle)
    if (entry !== undefined) entry.cleared = true
  }

  pendingCount = (): number => [...this.entries.values()].filter((entry) => !entry.cleared).length

  advance = (ms: number): void => {
    const target = this.nowMs + ms
    for (;;) {
      const due = [...this.entries.entries()]
        .filter(([, entry]) => !entry.cleared && entry.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0]
      if (due === undefined) break
      this.nowMs = Math.max(this.nowMs, due[1].at)
      const [, entry] = due
      this.entries.delete(due[0])
      entry.fn()
    }
    this.nowMs = target
  }
}

interface FakeBus {
  listeners: Set<(event: DebugEvent) => void>
  subscribe: (listener: (event: DebugEvent) => void) => void
  unsubscribe: (listener: (event: DebugEvent) => void) => void
  emit: (event: DebugEvent) => void
  emitUserPromptEvent: (type: string, promptId: string, userId: string, at: number) => void
  emitGroupPromptEvent: (type: string, promptId: string, groupId: string, at: number) => void
}

const makeFakeBus = (): FakeBus => {
  const listeners = new Set<(event: DebugEvent) => void>()
  const emit = (event: DebugEvent): void => {
    for (const listener of [...listeners]) listener(event)
  }
  return {
    listeners,
    subscribe: (listener: (event: DebugEvent) => void): void => {
      listeners.add(listener)
    },
    unsubscribe: (listener: (event: DebugEvent) => void): void => {
      listeners.delete(listener)
    },
    emit,
    emitUserPromptEvent: (type: string, promptId: string, userId: string, at: number): void => {
      emit({ type, timestamp: at, scope: { kind: 'user', userId }, data: { promptId } })
    },
    emitGroupPromptEvent: (type: string, promptId: string, groupId: string, at: number): void => {
      emit({ type, timestamp: at, scope: { kind: 'group', groupId }, data: { promptId } })
    },
  }
}

interface FakeWorld {
  scheduled: Map<string, ScheduledPrompt>
  alerts: Map<string, AlertPrompt>
  createCalls: Array<{ userId: string; input: CreateInput; deliveryCtx: CreateDeliveryContext | undefined }>
  updateCalls: Array<{ userId: string; input: UpdateInput }>
  cancelCalls: Array<{ userId: string; id: string }>
  createError: string | null
  createWithExecutionMode: boolean
  updatePreservesEmptyPrompt: boolean
  traces: LlmTrace[]
  history: ModelMessage[]
}

const makeWorld = (): FakeWorld => ({
  scheduled: new Map(),
  alerts: new Map(),
  createCalls: [],
  updateCalls: [],
  cancelCalls: [],
  createError: null,
  createWithExecutionMode: false,
  updatePreservesEmptyPrompt: false,
  traces: [],
  history: [],
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

const makeScheduledRow = (
  id: string,
  ownerId: string,
  prompt: string,
  fireAt: string,
  status: ScheduledPrompt['status'] = 'active',
): ScheduledPrompt => ({
  type: 'scheduled',
  id,
  createdByUserId: ownerId,
  createdByUsername: null,
  deliveryTarget: deliveryTargetFor(ownerId),
  prompt,
  fireAt,
  rrule: null,
  dtstartUtc: null,
  timezone: null,
  status,
  createdAt: new Date(CLOCK_BASE_MS).toISOString(),
  lastExecutedAt: null,
  executionMetadata: { delivery_brief: '', context_snapshot: null },
})

const makeAlertRow = (id: string, ownerId: string, prompt: string, condition: AlertCondition): AlertPrompt => ({
  type: 'alert',
  id,
  createdByUserId: ownerId,
  createdByUsername: null,
  deliveryTarget: deliveryTargetFor(ownerId),
  prompt,
  condition,
  status: 'active',
  createdAt: new Date(CLOCK_BASE_MS).toISOString(),
  lastTriggeredAt: null,
  lastActivityCursor: null,
  cooldownMinutes: 60,
  executionMetadata: { delivery_brief: '', context_snapshot: null },
  matchedTaskIds: [],
  taskInstanceId: null,
})

let idSeq = 0
const nextId = (prefix: string): string => `${prefix}-${++idSeq}`

const makeHandlers = (
  world: FakeWorld,
): Pick<ProofCheckDeps, 'executeCreate' | 'executeUpdate' | 'executeGet' | 'executeCancel'> => ({
  executeCreate: (userId: string, input: CreateInput, deliveryCtx?: CreateDeliveryContext): CreateResult => {
    world.createCalls.push({ userId, input, deliveryCtx })
    if (world.createError !== null) return { error: world.createError }
    if (input.condition !== undefined) {
      const id = nextId('al')
      world.alerts.set(id, makeAlertRow(id, userId, input.prompt, input.condition))
      return { status: 'created', type: 'alert', id, cooldownMinutes: 60 }
    }
    const schedule = input.schedule
    if (schedule?.fire_at === undefined) return { error: 'Schedule must include fire_at.' }
    const fireAt = localDatetimeToUtc(schedule.fire_at.date, schedule.fire_at.time, 'UTC')
    const id = nextId('sp')
    world.scheduled.set(id, makeScheduledRow(id, userId, input.prompt, fireAt))
    const result: CreateResult = { status: 'created', type: 'scheduled', id, fireAt, rrule: null }
    if (world.createWithExecutionMode) {
      return { ...result, execution: { mode: 'scheduled' } } as CreateResult
    }
    return result
  },
  executeUpdate: (userId: string, input: UpdateInput): UpdateResult => {
    world.updateCalls.push({ userId, input })
    const row = world.scheduled.get(input.id) ?? world.alerts.get(input.id)
    if (row === undefined) return { error: 'Reminder or alert not found.' }
    if (input.prompt !== undefined && !(world.updatePreservesEmptyPrompt && input.prompt === '')) {
      row.prompt = input.prompt
    }
    if (input.execution !== undefined) {
      row.executionMetadata = {
        delivery_brief: input.execution.delivery_brief,
        context_snapshot: input.execution.context_snapshot ?? null,
      }
    }
    return { ...row, status: 'updated' } as UpdateResult
  },
  executeGet: (userId: string, input: { id: string }): GetResult => {
    const row = world.scheduled.get(input.id) ?? world.alerts.get(input.id)
    if (row === undefined || row.createdByUserId !== userId) return { error: 'Reminder or alert not found.' }
    return row
  },
  executeCancel: (userId: string, input: { id: string }): CancelResult => {
    world.cancelCalls.push({ userId, id: input.id })
    const row = world.scheduled.get(input.id) ?? world.alerts.get(input.id)
    if (row === undefined) return { error: 'Reminder or alert not found.' }
    row.status = 'cancelled'
    return { status: 'cancelled', id: input.id }
  },
})

interface Harness {
  world: FakeWorld
  timers: FakeTimers
  bus: FakeBus
  records: ProofCheckRecord[]
  deps: ProofCheckDeps
}

const makeHarness = (): Harness => {
  const world = makeWorld()
  const timers = new FakeTimers()
  const bus = makeFakeBus()
  const records: ProofCheckRecord[] = []
  const owned = <T extends { createdByUserId: string }>(row: T | undefined, userId: string): T | null =>
    row !== undefined && row.createdByUserId === userId ? row : null
  const deps: ProofCheckDeps = {
    now: () => timers.nowMs,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    subscribe: bus.subscribe,
    unsubscribe: bus.unsubscribe,
    ...makeHandlers(world),
    listScheduledPrompts: () => [...world.scheduled.values()],
    listAlertPrompts: () => [...world.alerts.values()],
    getScheduledPrompt: (id, userId) => owned(world.scheduled.get(id), userId),
    getAlertPrompt: (id, userId) => owned(world.alerts.get(id), userId),
    store: {
      append: (record) => {
        records.push(record)
        return Promise.resolve()
      },
      load: () => Promise.resolve([...records]),
    },
    readRecentLlm: () => world.traces,
    readCachedHistory: () => world.history,
  }
  return { world, timers, bus, records, deps }
}

const makeTrace = (overrides: Partial<LlmTrace> = {}): LlmTrace => ({
  timestamp: CLOCK_BASE_MS,
  userId: ADMIN_STORAGE_ID,
  chatUserId: ADMIN_CHAT_ID,
  model: 'test-model',
  steps: 1,
  totalTokens: { inputTokens: 1, outputTokens: 1 },
  duration: 10,
  toolCalls: [],
  error: undefined,
  responseId: undefined,
  actualModel: undefined,
  finishReason: 'stop',
  messageCount: undefined,
  toolCount: undefined,
  exposedToolCount: undefined,
  fullToolCount: undefined,
  toolSchemaBytes: undefined,
  routingIntent: undefined,
  routingConfidence: undefined,
  routingReason: undefined,
  generatedText: undefined,
  stepsDetail: [],
  ...overrides,
})

const historyMessages = (...contents: string[]): ModelMessage[] =>
  contents.map((content) => ({ role: 'user', content }) as ModelMessage)

const singleKey = (rows: ReadonlyMap<string, unknown>): string => {
  expect(rows.size).toBe(1)
  return [...rows.keys()][0]!
}

describe('proof checks runner', () => {
  let harness: Harness
  let envDir: string
  let originalDbPath: string | undefined

  const makeRequest = (overrides: Partial<ProofCheckRequest> = {}): ProofCheckRequest => ({
    check: 'bug2_context_time',
    storageContextId: ADMIN_STORAGE_ID,
    chatUserId: ADMIN_CHAT_ID,
    ...overrides,
  })

  const expectCompleted = (outcome: ProofCheckOutcome): ProofCheckRecord => {
    if (outcome.status !== 'completed') throw new Error(`Expected a completed outcome, got ${JSON.stringify(outcome)}`)
    return outcome.record
  }

  const expectStarted = async (request: ProofCheckRequest): Promise<string> => {
    const outcome = await runProofCheck(harness.deps, request)
    if (outcome.status !== 'started') throw new Error(`Expected a started outcome, got ${JSON.stringify(outcome)}`)
    return outcome.run_id
  }

  const expectCleaned = (outcome: ProofCheckOutcome): string[] => {
    if (outcome.status !== 'cleaned') throw new Error(`Expected a cleaned outcome, got ${JSON.stringify(outcome)}`)
    return outcome.cancelled
  }

  const waitForRecord = async (minimum = 1): Promise<ProofCheckRecord> => {
    await waitFor(() => harness.records.length >= minimum)
    return harness.records[harness.records.length - 1]!
  }

  const drainToTimeout = (): Promise<ProofCheckRecord> => {
    harness.timers.advance(DRAIN_ADVANCE_MS)
    return waitForRecord()
  }

  const reconstructedFireAtMs = (callIndex: number): number => {
    const fireAt = harness.world.createCalls[callIndex]?.input.schedule?.fire_at
    if (fireAt === undefined) throw new Error(`Create call ${callIndex} carries no fire_at`)
    return Date.parse(localDatetimeToUtc(fireAt.date, fireAt.time, 'UTC'))
  }

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    resetProofChecksForTest()
    harness = makeHarness()
    idSeq = 0
    envDir = mkdtempSync(join(tmpdir(), 'papai-proof-checks-'))
    originalDbPath = process.env['DB_PATH']
    process.env['DB_PATH'] = join(envDir, 'papai.db')
  })

  afterEach(() => {
    if (originalDbPath === undefined) delete process.env['DB_PATH']
    else process.env['DB_PATH'] = originalDbPath
    rmSync(envDir, { recursive: true, force: true })
  })

  test('PROOF_CHECKS covers exactly the five check ids with pinned kinds and variants', () => {
    expect(Object.keys(PROOF_CHECKS).sort()).toEqual(
      [
        'bug1_delivery_matches_execution',
        'bug2_context_time',
        'bug3_fires_on_creation',
        'bug4_create_response_mode',
        'bug5_update_preserves_prompt',
      ].sort(),
    )
    expect(PROOF_CHECKS['bug1_delivery_matches_execution']).toMatchObject({
      kind: 'async',
      variants: ['no_tools', 'with_tool_probe'],
    })
    expect(PROOF_CHECKS['bug2_context_time']).toMatchObject({ kind: 'async', variants: ['default'] })
    expect(PROOF_CHECKS['bug3_fires_on_creation']).toMatchObject({ kind: 'async', variants: ['scheduled', 'alert'] })
    expect(PROOF_CHECKS['bug4_create_response_mode']).toMatchObject({ kind: 'sync', variants: ['default'] })
    expect(PROOF_CHECKS['bug5_update_preserves_prompt']).toMatchObject({ kind: 'sync', variants: ['default'] })
  })

  test('a variant outside the check def is rejected with a structured error and runs nothing', async () => {
    expect(await runProofCheck(harness.deps, makeRequest({ variant: 'alert' }))).toEqual({
      status: 'error',
      error: "Variant 'alert' is not valid for bug2_context_time (expected one of: default).",
    })
    expect(
      await runProofCheck(harness.deps, makeRequest({ check: 'bug4_create_response_mode', variant: 'alert' })),
    ).toEqual({
      status: 'error',
      error: "Variant 'alert' is not valid for bug4_create_response_mode (expected one of: default).",
    })

    expect(harness.world.createCalls).toHaveLength(0)
    expect(harness.records).toHaveLength(0)
  })

  test('bug4 runs inline, fails without execution.mode in the create result, and cancels the proof prompt', async () => {
    const record = expectCompleted(
      await runProofCheck(harness.deps, makeRequest({ check: 'bug4_create_response_mode' })),
    )

    expect(record.check).toBe('bug4_create_response_mode')
    expect(record.verdict).toBe('fail')
    expect(record.observations.length).toBeGreaterThan(0)
    expect(Number.isNaN(Date.parse(record.started_at))).toBe(false)
    expect(Number.isNaN(Date.parse(record.finished_at))).toBe(false)

    const createCall = harness.world.createCalls[0]
    expect(createCall).toBeDefined()
    expect(createCall?.userId).toBe(ADMIN_STORAGE_ID)
    expect(createCall?.deliveryCtx).toMatchObject({
      userId: ADMIN_CHAT_ID,
      storageContextId: ADMIN_STORAGE_ID,
      contextType: 'dm',
    })
    expect(createCall?.input.prompt.startsWith(proofMarker(record.run_id))).toBe(true)

    const createdId = singleKey(harness.world.scheduled)
    expect(record.run_id).not.toBe('')
    expect(harness.world.cancelCalls.map((call) => call.id)).toContain(createdId)
    expect(harness.world.cancelCalls[0]?.userId).toBe(ADMIN_STORAGE_ID)
    expect(harness.world.updateCalls).toHaveLength(0)
  })

  test('bug4 passes when the create result carries execution.mode and still cancels', async () => {
    harness.world.createWithExecutionMode = true

    const record = expectCompleted(
      await runProofCheck(harness.deps, makeRequest({ check: 'bug4_create_response_mode' })),
    )

    expect(record.verdict).toBe('pass')
    const cancelledIds = harness.world.cancelCalls.map((call) => call.id)
    expect(cancelledIds).toContain(singleKey(harness.world.scheduled))
  })

  test('bug4 records inconclusive and cancels nothing when create errors', async () => {
    harness.world.createError = 'create exploded'

    const record = expectCompleted(
      await runProofCheck(harness.deps, makeRequest({ check: 'bug4_create_response_mode' })),
    )

    expect(record.verdict).toBe('inconclusive')
    expect(harness.world.cancelCalls).toHaveLength(0)
  })

  test('bug5 runs create, update with empty prompt plus changed execution, and get, failing when the wiped text is stored', async () => {
    const record = expectCompleted(
      await runProofCheck(harness.deps, makeRequest({ check: 'bug5_update_preserves_prompt' })),
    )

    expect(record.check).toBe('bug5_update_preserves_prompt')
    expect(record.verdict).toBe('fail')

    const createdId = singleKey(harness.world.scheduled)
    const updateCall = harness.world.updateCalls[0]
    expect(updateCall).toBeDefined()
    expect(updateCall?.userId).toBe(ADMIN_STORAGE_ID)
    expect(updateCall?.input.id).toBe(createdId)
    expect(updateCall?.input.prompt).toBe('')
    expect(updateCall?.input.execution?.delivery_brief).toBeDefined()
    expect(updateCall?.input.execution?.delivery_brief).not.toBe(
      harness.world.createCalls[0]?.input.execution?.delivery_brief,
    )

    const cancelledIds = harness.world.cancelCalls.map((call) => call.id)
    expect(cancelledIds).toContain(createdId)
  })

  test('bug5 passes when the stored prompt text survives the update', async () => {
    harness.world.updatePreservesEmptyPrompt = true

    const record = expectCompleted(
      await runProofCheck(harness.deps, makeRequest({ check: 'bug5_update_preserves_prompt' })),
    )

    expect(record.verdict).toBe('pass')
    expect(harness.world.scheduled.get(singleKey(harness.world.scheduled))?.prompt).not.toBe('')
    expect(harness.world.cancelCalls.map((call) => call.id)).toContain(singleKey(harness.world.scheduled))
  })

  test('a throwing sync observation still cancels the proof prompt and records the error', async () => {
    harness.deps.executeUpdate = (): UpdateResult => {
      throw new Error('update exploded')
    }

    const record = expectCompleted(
      await runProofCheck(harness.deps, makeRequest({ check: 'bug5_update_preserves_prompt' })),
    )

    expect(record.verdict).toBe('inconclusive')
    expect(record.observations.join('\n')).toContain('observation_error: update exploded')
    expect(harness.world.cancelCalls.map((call) => call.id)).toContain(singleKey(harness.world.scheduled))
  })

  test('a throwing sync cancel still records the run with the failure observation', async () => {
    harness.deps.executeCancel = (): CancelResult => {
      throw new Error('cancel exploded')
    }

    const record = expectCompleted(
      await runProofCheck(harness.deps, makeRequest({ check: 'bug4_create_response_mode' })),
    )

    expect(record.verdict).toBe('fail')
    expect(record.observations.join('\n')).toContain('cancel_error: cancel exploded')
  })

  test('async check returns started with a run_id matching the created marker and drains with a full teardown', async () => {
    const runId = await expectStarted(makeRequest())

    expect(runId).toMatch(UUID_RE)
    await waitFor(() => harness.world.createCalls.length > 0)
    const createCall = harness.world.createCalls[0]
    expect(createCall?.userId).toBe(ADMIN_STORAGE_ID)
    expect(createCall?.deliveryCtx).toMatchObject({
      userId: ADMIN_CHAT_ID,
      storageContextId: ADMIN_STORAGE_ID,
      contextType: 'dm',
    })
    expect(createCall?.input.prompt.startsWith(`[[proof-check:${runId}]]`)).toBe(true)
    expect(proofMarker(runId)).toBe(`[[proof-check:${runId}]]`)
    expect(createCall?.input.execution?.delivery_brief).toContain(runId)

    const proofId = singleKey(harness.world.scheduled)
    const record = await drainToTimeout()

    expect(record.run_id).toBe(runId)
    expect(harness.bus.listeners.size).toBe(0)
    expect(harness.timers.pendingCount()).toBe(0)
    const proofCancel = harness.world.cancelCalls.find((call) => call.id === proofId)
    expect(proofCancel?.userId).toBe(ADMIN_STORAGE_ID)
  })

  test('async observation matches deferred:fired only for the proof prompt id in user scope', async () => {
    const runId = await expectStarted(makeRequest({ check: 'bug3_fires_on_creation' }))
    await waitFor(() => harness.world.createCalls.length > 0)
    const proofId = singleKey(harness.world.scheduled)
    harness.timers.nowMs = CLOCK_BASE_MS + 10_000

    harness.bus.emitGroupPromptEvent('deferred:fired', proofId, 'group-1', harness.timers.nowMs)
    await flushMicrotasks()
    expect(harness.records).toHaveLength(0)
    expect(harness.bus.listeners.size).toBe(1)

    harness.bus.emitUserPromptEvent('deferred:fired', 'other-prompt', ADMIN_STORAGE_ID, harness.timers.nowMs)
    await flushMicrotasks()
    expect(harness.records).toHaveLength(0)

    harness.bus.emitUserPromptEvent('deferred:fired', proofId, ADMIN_STORAGE_ID, harness.timers.nowMs)
    const record = await waitForRecord()

    expect(record.run_id).toBe(runId)
    expect(record.check).toBe('bug3_fires_on_creation')
    expect(record.verdict).toBe('fail')
    expect(harness.bus.listeners.size).toBe(0)
    expect(harness.timers.pendingCount()).toBe(0)
  })

  test('deferred:alerted drives the alert variant and any execution inside the window fails', async () => {
    const runId = await expectStarted(makeRequest({ check: 'bug3_fires_on_creation', variant: 'alert' }))
    await waitFor(() => harness.world.createCalls.length > 0)

    const createCall = harness.world.createCalls[0]
    expect(createCall?.input.condition).toBeDefined()
    expect(createCall?.input.schedule).toBeUndefined()
    const alertId = singleKey(harness.world.alerts)
    harness.timers.nowMs = CLOCK_BASE_MS + 10_000

    harness.bus.emitUserPromptEvent('deferred:alerted', alertId, ADMIN_STORAGE_ID, harness.timers.nowMs)
    const record = await waitForRecord()

    expect(record.run_id).toBe(runId)
    expect(record.variant).toBe('alert')
    expect(record.verdict).toBe('fail')
    expect(harness.bus.listeners.size).toBe(0)
    expect(harness.world.cancelCalls.map((call) => call.id)).toContain(alertId)
  })

  test('row-read fallback at window close records the verdict when no event fires', async () => {
    await expectStarted(makeRequest({ check: 'bug3_fires_on_creation' }))
    await waitFor(() => harness.world.createCalls.length > 0)
    const proofId = singleKey(harness.world.scheduled)
    const proofRow = harness.world.scheduled.get(proofId)
    expect(proofRow).toBeDefined()
    const fireAtMs = Date.parse(proofRow!.fireAt)
    expect(Number.isNaN(fireAtMs)).toBe(false)
    harness.world.scheduled.set(proofId, {
      ...harness.world.scheduled.get(proofId)!,
      lastExecutedAt: new Date(fireAtMs - MINUTE_MS).toISOString(),
    })

    const record = await drainToTimeout()

    expect(record.check).toBe('bug3_fires_on_creation')
    expect(record.verdict).toBe('fail')
    expect(harness.bus.listeners.size).toBe(0)
  })

  test('bug3 passes when nothing executes inside the window', async () => {
    await expectStarted(makeRequest({ check: 'bug3_fires_on_creation' }))
    await waitFor(() => harness.world.createCalls.length > 0)

    const record = await drainToTimeout()

    expect(record.check).toBe('bug3_fires_on_creation')
    expect(record.verdict).toBe('pass')
    expect(harness.bus.listeners.size).toBe(0)
  })

  test('window defaults, wait_seconds handling, and the alert-variant window', async () => {
    await expectStarted(makeRequest())
    expect(harness.timers.delays).toEqual([2 * SCHEDULED_POLL_MS])
    await drainToTimeout()

    await expectStarted(makeRequest({ wait_seconds: 30 }))
    expect(harness.timers.delays[1]).toBe(2 * SCHEDULED_POLL_MS)
    await drainToTimeout()

    await expectStarted(makeRequest({ wait_seconds: WINDOW_CAP_MS / 1000 + 600 }))
    expect(harness.timers.delays[2]).toBe(WINDOW_CAP_MS)
    await drainToTimeout()

    await expectStarted(makeRequest({ check: 'bug3_fires_on_creation', variant: 'alert' }))
    expect(harness.timers.delays[3]).toBe(2 * ALERT_POLL_MS)
    await drainToTimeout()

    expect(harness.timers.delays).toHaveLength(4)
  })

  test('fire_at derivation targets half the effective window, bug3 pins the lead, and stays inside a wait_seconds window', async () => {
    harness.timers.nowMs = CLOCK_BASE_MS
    await expectStarted(makeRequest())
    await waitFor(() => harness.world.createCalls.length > 0)
    const defaultFireAt = reconstructedFireAtMs(0)
    expect(defaultFireAt).toBe(minuteFloorMs(CLOCK_BASE_MS + 60_000))
    expect(defaultFireAt).toBeLessThanOrEqual(CLOCK_BASE_MS + 2 * SCHEDULED_POLL_MS)
    await drainToTimeout()

    harness.timers.nowMs = CLOCK_BASE_MS
    await expectStarted(makeRequest({ check: 'bug3_fires_on_creation' }))
    await waitFor(() => harness.world.createCalls.length > 1)
    expect(reconstructedFireAtMs(1)).toBe(CLOCK_BASE_MS + 10 * MINUTE_MS)
    await drainToTimeout()

    harness.timers.nowMs = CLOCK_BASE_MS + 7_000
    await expectStarted(makeRequest({ wait_seconds: 60 }))
    await waitFor(() => harness.world.createCalls.length > 2)
    const shrunkStartMs = CLOCK_BASE_MS + 7_000
    const shrunkFireAt = reconstructedFireAtMs(2)
    // wait_seconds: 60 floors up to the scheduled-lane default window (2 poll intervals)
    const shrunkWindowClose = shrunkStartMs + 2 * SCHEDULED_POLL_MS
    expect(shrunkFireAt).toBe(CLOCK_BASE_MS + MINUTE_MS)
    expect(shrunkFireAt).toBeGreaterThan(shrunkStartMs)
    expect(shrunkFireAt).toBeLessThanOrEqual(shrunkWindowClose)
    await drainToTimeout()

    await runProofCheck(harness.deps, makeRequest({ check: 'bug4_create_response_mode' }))
    await waitFor(() => harness.world.createCalls.length > 3)
    expect(reconstructedFireAtMs(3)).toBeGreaterThan(CLOCK_BASE_MS)
  })

  test('timeout teardown cancels, unsubscribes, and records an inconclusive verdict', async () => {
    const runId = await expectStarted(makeRequest())
    await waitFor(() => harness.world.createCalls.length > 0)
    const proofId = singleKey(harness.world.scheduled)

    const record = await drainToTimeout()

    expect(record.run_id).toBe(runId)
    expect(record.verdict).toBe('inconclusive')
    expect(harness.bus.listeners.size).toBe(0)
    expect(harness.timers.pendingCount()).toBe(0)
    expect(harness.world.cancelCalls.map((call) => call.id)).toContain(proofId)
  })

  test('observation errors are recorded as inconclusive and never escape the detached run', async () => {
    const runId = await expectStarted(makeRequest())
    await waitFor(() => harness.world.createCalls.length > 0)
    const proofId = singleKey(harness.world.scheduled)
    harness.deps.readCachedHistory = (): readonly ModelMessage[] => {
      throw new Error('history read exploded')
    }
    harness.timers.nowMs = CLOCK_BASE_MS + 1_000

    harness.bus.emitUserPromptEvent('deferred:fired', proofId, ADMIN_STORAGE_ID, harness.timers.nowMs)
    const record = await waitForRecord()

    expect(record.run_id).toBe(runId)
    expect(record.verdict).toBe('inconclusive')
    expect(harness.bus.listeners.size).toBe(0)
    expect(harness.timers.pendingCount()).toBe(0)
    expect(harness.world.cancelCalls.map((call) => call.id)).toContain(proofId)
  })

  test('a second concurrent async run is busy until the first run finishes', async () => {
    await expectStarted(makeRequest())

    expect(await runProofCheck(harness.deps, makeRequest())).toEqual({ status: 'busy' })

    await drainToTimeout()
    await expectStarted(makeRequest())
    await drainToTimeout()
    expect(harness.records).toHaveLength(2)
  })

  test('a sync check is busy while an async run is in flight and its proof prompt survives the refusal', async () => {
    const runId = await expectStarted(makeRequest())
    await waitFor(() => harness.world.createCalls.length > 0)
    const proofId = singleKey(harness.world.scheduled)

    expect(await runProofCheck(harness.deps, makeRequest({ check: 'bug4_create_response_mode' }))).toEqual({
      status: 'busy',
    })
    expect(harness.world.createCalls).toHaveLength(1)
    expect(harness.world.cancelCalls.map((call) => call.id)).not.toContain(proofId)

    const record = await drainToTimeout()
    expect(harness.records).toHaveLength(1)
    expect(record.run_id).toBe(runId)
  })

  test('bug2 fails when the last current_time anchor is stale beyond tolerance', async () => {
    const fireMs = CLOCK_BASE_MS + 5 * MINUTE_MS
    harness.world.history = historyMessages(formatCurrentTimeTag(new Date(fireMs - 10 * MINUTE_MS), 'UTC'))
    harness.world.traces = [makeTrace({ timestamp: fireMs + 1_000 })]

    const runId = await expectStarted(makeRequest())
    await waitFor(() => harness.world.createCalls.length > 0)
    const proofId = singleKey(harness.world.scheduled)
    harness.timers.nowMs = fireMs
    harness.bus.emitUserPromptEvent('deferred:fired', proofId, ADMIN_STORAGE_ID, fireMs)

    const record = await waitForRecord()

    expect(record.run_id).toBe(runId)
    expect(record.check).toBe('bug2_context_time')
    expect(record.verdict).toBe('fail')
  })

  test('bug2 passes when the anchor is within tolerance', async () => {
    const fireMs = CLOCK_BASE_MS + 5 * MINUTE_MS
    harness.world.history = historyMessages(
      formatCurrentTimeTag(new Date(fireMs - 10 * MINUTE_MS), 'UTC'),
      formatCurrentTimeTag(new Date(fireMs - MINUTE_MS), 'UTC'),
    )
    harness.world.traces = [makeTrace({ timestamp: fireMs + 1_000 })]

    await expectStarted(makeRequest())
    await waitFor(() => harness.world.createCalls.length > 0)
    const proofId = singleKey(harness.world.scheduled)
    harness.timers.nowMs = fireMs
    harness.bus.emitUserPromptEvent('deferred:fired', proofId, ADMIN_STORAGE_ID, fireMs)

    const record = await waitForRecord()

    expect(record.verdict).toBe('pass')
  })

  test('bug2 is inconclusive without a current_time tag in the cached history', async () => {
    const fireMs = CLOCK_BASE_MS + 5 * MINUTE_MS
    harness.world.history = historyMessages('a message without any time tag')
    harness.world.traces = [makeTrace({ timestamp: fireMs + 1_000 })]

    await expectStarted(makeRequest())
    await waitFor(() => harness.world.createCalls.length > 0)
    const proofId = singleKey(harness.world.scheduled)
    harness.timers.nowMs = fireMs
    harness.bus.emitUserPromptEvent('deferred:fired', proofId, ADMIN_STORAGE_ID, fireMs)

    const record = await waitForRecord()

    expect(record.verdict).toBe('inconclusive')
  })

  test('bug2 is inconclusive when no trace correlates the run', async () => {
    const fireMs = CLOCK_BASE_MS + 5 * MINUTE_MS
    harness.world.history = historyMessages(formatCurrentTimeTag(new Date(fireMs - 10 * MINUTE_MS), 'UTC'))
    harness.world.traces = []

    await expectStarted(makeRequest())
    await waitFor(() => harness.world.createCalls.length > 0)
    const proofId = singleKey(harness.world.scheduled)
    harness.timers.nowMs = fireMs
    harness.bus.emitUserPromptEvent('deferred:fired', proofId, ADMIN_STORAGE_ID, fireMs)

    const record = await waitForRecord()

    expect(record.verdict).toBe('inconclusive')
  })

  test('bug1 fails when the delivered text is the localized doneFallback stub while the trace shows good text', async () => {
    const fireMs = CLOCK_BASE_MS + 5 * MINUTE_MS
    const stub = t('completion.doneFallback')
    harness.world.traces = [
      makeTrace({ timestamp: fireMs + 1_000, generatedText: 'Real answer text', finishReason: 'stop' }),
    ]

    const runId = await expectStarted(makeRequest({ check: 'bug1_delivery_matches_execution', variant: 'no_tools' }))
    await waitFor(() => harness.world.createCalls.length > 0)
    const proofId = singleKey(harness.world.scheduled)
    recordProofDelivery(runId, stub, new Date(fireMs).toISOString())
    harness.timers.nowMs = fireMs
    harness.bus.emitUserPromptEvent('deferred:fired', proofId, ADMIN_STORAGE_ID, fireMs)

    const record = await waitForRecord()

    expect(record.run_id).toBe(runId)
    expect(record.variant).toBe('no_tools')
    expect(record.verdict).toBe('fail')
    expect(record.observations.join('\n')).toContain(stub)
  })

  test('bug1 passes when the delivered text matches the generated text', async () => {
    const fireMs = CLOCK_BASE_MS + 5 * MINUTE_MS
    harness.world.traces = [
      makeTrace({ timestamp: fireMs + 1_000, generatedText: 'Real answer text', finishReason: 'stop' }),
    ]

    const runId = await expectStarted(makeRequest({ check: 'bug1_delivery_matches_execution', variant: 'no_tools' }))
    await waitFor(() => harness.world.createCalls.length > 0)
    const proofId = singleKey(harness.world.scheduled)
    recordProofDelivery(runId, 'Real answer text', new Date(fireMs).toISOString())
    harness.timers.nowMs = fireMs
    harness.bus.emitUserPromptEvent('deferred:fired', proofId, ADMIN_STORAGE_ID, fireMs)

    const record = await waitForRecord()

    expect(record.verdict).toBe('pass')
  })

  test('bug1 passes when the stub correctly covers an empty generation', async () => {
    const fireMs = CLOCK_BASE_MS + 5 * MINUTE_MS
    harness.world.traces = [makeTrace({ timestamp: fireMs + 1_000, generatedText: '', finishReason: 'stop' })]

    const runId = await expectStarted(makeRequest({ check: 'bug1_delivery_matches_execution', variant: 'no_tools' }))
    await waitFor(() => harness.world.createCalls.length > 0)
    const proofId = singleKey(harness.world.scheduled)
    recordProofDelivery(runId, t('completion.doneFallback'), new Date(fireMs).toISOString())
    harness.timers.nowMs = fireMs
    harness.bus.emitUserPromptEvent('deferred:fired', proofId, ADMIN_STORAGE_ID, fireMs)

    const record = await waitForRecord()

    expect(record.verdict).toBe('pass')
  })

  test('bug1 passes when the turn was cut off by a pending tool call', async () => {
    const fireMs = CLOCK_BASE_MS + 5 * MINUTE_MS
    harness.world.traces = [
      makeTrace({ timestamp: fireMs + 1_000, generatedText: 'Checking the time', finishReason: 'tool-calls' }),
    ]

    const runId = await expectStarted(makeRequest({ check: 'bug1_delivery_matches_execution', variant: 'no_tools' }))
    await waitFor(() => harness.world.createCalls.length > 0)
    const proofId = singleKey(harness.world.scheduled)
    recordProofDelivery(runId, t('completion.doneFallback'), new Date(fireMs).toISOString())
    harness.timers.nowMs = fireMs
    harness.bus.emitUserPromptEvent('deferred:fired', proofId, ADMIN_STORAGE_ID, fireMs)

    const record = await waitForRecord()

    expect(record.verdict).toBe('pass')
  })

  test('bug1 is inconclusive without a delivery record', async () => {
    const fireMs = CLOCK_BASE_MS + 5 * MINUTE_MS
    harness.world.traces = [
      makeTrace({ timestamp: fireMs + 1_000, generatedText: 'Real answer text', finishReason: 'stop' }),
    ]

    await expectStarted(makeRequest({ check: 'bug1_delivery_matches_execution', variant: 'no_tools' }))
    await waitFor(() => harness.world.createCalls.length > 0)
    const proofId = singleKey(harness.world.scheduled)
    harness.timers.nowMs = fireMs
    harness.bus.emitUserPromptEvent('deferred:fired', proofId, ADMIN_STORAGE_ID, fireMs)

    const record = await waitForRecord()

    expect(record.verdict).toBe('inconclusive')
  })

  test('every run sweeps leftover proof prompts owned by the admin storage context only', async () => {
    harness.world.scheduled.set(
      'sp-sweep-a',
      makeScheduledRow(
        'sp-sweep-a',
        ADMIN_STORAGE_ID,
        `${MARKER_PREFIX}abc1]] leftover`,
        new Date(CLOCK_BASE_MS).toISOString(),
      ),
    )
    harness.world.alerts.set(
      'al-sweep-a',
      makeAlertRow('al-sweep-a', ADMIN_STORAGE_ID, `${MARKER_PREFIX}abc2]] leftover alert`, TEST_CONDITION),
    )
    harness.world.scheduled.set(
      'sp-plain',
      makeScheduledRow('sp-plain', ADMIN_STORAGE_ID, 'plain reminder', new Date(CLOCK_BASE_MS).toISOString()),
    )
    harness.world.scheduled.set(
      'sp-done',
      makeScheduledRow(
        'sp-done',
        ADMIN_STORAGE_ID,
        `${MARKER_PREFIX}abc3]] old`,
        new Date(CLOCK_BASE_MS).toISOString(),
        'cancelled',
      ),
    )
    harness.world.scheduled.set(
      'sp-foreign',
      makeScheduledRow(
        'sp-foreign',
        OTHER_STORAGE_ID,
        `${MARKER_PREFIX}abc4]] foreign`,
        new Date(CLOCK_BASE_MS).toISOString(),
      ),
    )

    expectCompleted(await runProofCheck(harness.deps, makeRequest({ check: 'bug4_create_response_mode' })))

    const cancelledIds = harness.world.cancelCalls.map((call) => call.id)
    expect(cancelledIds).toContain('sp-sweep-a')
    expect(cancelledIds).toContain('al-sweep-a')
    expect(cancelledIds).not.toContain('sp-plain')
    expect(cancelledIds).not.toContain('sp-done')
    expect(cancelledIds).not.toContain('sp-foreign')
  })

  test('cleanup cancels admin-owned marker prompts, returns their ids, and runs no check', async () => {
    harness.world.scheduled.set(
      'sp-sweep-a',
      makeScheduledRow(
        'sp-sweep-a',
        ADMIN_STORAGE_ID,
        `${MARKER_PREFIX}abc1]] leftover`,
        new Date(CLOCK_BASE_MS).toISOString(),
      ),
    )
    harness.world.alerts.set(
      'al-sweep-a',
      makeAlertRow('al-sweep-a', ADMIN_STORAGE_ID, `${MARKER_PREFIX}abc2]] leftover alert`, TEST_CONDITION),
    )
    harness.world.scheduled.set(
      'sp-foreign',
      makeScheduledRow(
        'sp-foreign',
        OTHER_STORAGE_ID,
        `${MARKER_PREFIX}abc4]] foreign`,
        new Date(CLOCK_BASE_MS).toISOString(),
      ),
    )

    const cancelled = expectCleaned(await runProofCheck(harness.deps, makeRequest({ check: undefined, cleanup: true })))
    expect(new Set(cancelled)).toEqual(new Set(['sp-sweep-a', 'al-sweep-a']))
    expect(cancelled).toHaveLength(2)
    expect(harness.world.createCalls).toHaveLength(0)
    expect(harness.records).toHaveLength(0)
  })

  describe('poller delivery record seam (D9)', () => {
    type RefusingChatProvider = ChatProvider & {
      isInstanceActive: (id: string) => boolean
      sendMessage: (platformInstanceId: string, target: DeferredDeliveryTarget, text: string) => Promise<false>
    }

    interface DeliveryRecordCall {
      runId: string
      responseText: string
      at: string
    }

    let sentMessages: Array<{ platformInstanceId: string; target: DeferredDeliveryTarget; text: string }>
    let chat: ChatProvider
    let recordCalls: DeliveryRecordCall[]
    let recordSpy: Mock<(runId: string, responseText: string, at: string) => void>
    const spies: Array<{ mockRestore: () => void }> = []

    const track = <T extends { mockRestore: () => void }>(spy: T): T => {
      spies.push(spy)
      return spy
    }

    const spyDeliveryRecord = (): void => {
      recordCalls = []
      recordSpy = track(
        spyOn(proofChecksObserve, 'recordProofDelivery').mockImplementation(
          (recordedRunId: string, responseText: string, at: string): void => {
            recordCalls.push({ runId: recordedRunId, responseText, at })
          },
        ),
      )
    }

    const setupPollerUser = (userId: string): void => {
      seedCommonTestPlatformInstances()
      seedTestPlatformInstance({ id: 'mock-default' })
      seedTestTaskInstance({ id: 'kaneo-default' })
      setConfig(userId, 'timezone', 'UTC')
      setContextSettings({ contextId: userId, taskInstanceId: 'kaneo-default', platformInstanceId: 'mock-default' })
      seedAdminLlmBinding()
    }

    const createDueProofPrompt = (userId: string, runId: string): void => {
      createScheduledPrompt(userId, `${proofMarker(runId)} proof body`, {
        fireAt: new Date(Date.now() - 60_000).toISOString(),
      })
    }

    beforeEach(() => {
      const mockChat = createMockChatWithSentMessages()
      chat = mockChat.provider
      sentMessages = mockChat.sentMessages
    })

    afterEach(() => {
      for (const spy of spies) spy.mockRestore()
      spies.length = 0
    })

    test('records the delivery only after the whole-marker group delivers, leaving the message untouched', async () => {
      const userId = 'proof-delivery-user'
      setupPollerUser(userId)
      const runId = '6f9619ff-8b86-d011-b42d-00cf4fc964ff'
      createDueProofPrompt(userId, runId)
      track(
        spyOn(proactiveLlmModule, 'dispatchExecution').mockImplementation(() =>
          Promise.resolve('Delivered proof reply.'),
        ),
      )
      spyDeliveryRecord()

      await pollScheduledOnce(chat, () => createMockProvider())

      expect(recordCalls).toHaveLength(1)
      expect(recordCalls[0]?.runId).toBe(runId)
      expect(recordCalls[0]?.responseText).toBe('Delivered proof reply.')
      expect(recordCalls[0]?.at).toMatch(/^\d{4}-\d{2}-\d{2}T/u)
      expect(sentMessages).toHaveLength(1)
      expect(sentMessages[0]?.text).toBe('Delivered proof reply.')
    })

    test('mixed marker and plain prompts in one group skip the record but still deliver', async () => {
      const userId = 'proof-mixed-user'
      setupPollerUser(userId)
      const pastTime = new Date(Date.now() - 60_000).toISOString()
      createDueProofPrompt(userId, '11111111-2222-4333-8444-555555555555')
      createScheduledPrompt(userId, 'plain reminder', { fireAt: pastTime })
      track(spyOn(proactiveLlmModule, 'dispatchExecution').mockImplementation(() => Promise.resolve('Merged reply.')))
      spyDeliveryRecord()

      await pollScheduledOnce(chat, () => createMockProvider())

      expect(recordSpy).not.toHaveBeenCalled()
      expect(sentMessages).toHaveLength(1)
      expect(sentMessages[0]?.text).toBe('Merged reply.')
    })

    test('plain groups never record', async () => {
      const userId = 'proof-plain-user'
      setupPollerUser(userId)
      createScheduledPrompt(userId, 'an ordinary reminder', { fireAt: new Date(Date.now() - 60_000).toISOString() })
      track(spyOn(proactiveLlmModule, 'dispatchExecution').mockImplementation(() => Promise.resolve('Ordinary reply.')))
      spyDeliveryRecord()

      await pollScheduledOnce(chat, () => createMockProvider())

      expect(recordSpy).not.toHaveBeenCalled()
      expect(sentMessages).toHaveLength(1)
      expect(sentMessages[0]?.text).toBe('Ordinary reply.')
    })

    test('error-path delivery is not recorded', async () => {
      const userId = 'proof-error-path-user'
      setupPollerUser(userId)
      createDueProofPrompt(userId, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')
      track(
        spyOn(proactiveLlmModule, 'dispatchExecution').mockImplementation(() =>
          Promise.reject(new Error('LLM exploded')),
        ),
      )
      spyDeliveryRecord()

      await pollScheduledOnce(chat, () => createMockProvider())

      expect(recordSpy).not.toHaveBeenCalled()
      expect(sentMessages).toHaveLength(1)
      expect(sentMessages[0]?.text).toContain('I ran into an error while working on that:')
    })

    test('no record when sendProactiveMessage resolves false', async () => {
      const userId = 'proof-refused-user'
      setupPollerUser(userId)
      createDueProofPrompt(userId, '99999999-8888-4777-8666-555555555555')
      track(
        spyOn(proactiveLlmModule, 'dispatchExecution').mockImplementation(() => Promise.resolve('Undelivered reply.')),
      )
      spyDeliveryRecord()
      chat = {
        ...chat,
        isInstanceActive: (_id: string): boolean => true,
        sendMessage: (_platformInstanceId: string, _target: DeferredDeliveryTarget, _text: string): Promise<false> =>
          Promise.resolve(false),
      } as RefusingChatProvider

      await pollScheduledOnce(chat, () => createMockProvider())

      expect(recordSpy).not.toHaveBeenCalled()
      expect(sentMessages).toHaveLength(0)
    })

    test('the record line persists through the real seam to the proof store', async () => {
      const userId = 'proof-persist-user'
      setupPollerUser(userId)
      const runId = 'c0ffee00-1234-4abc-9def-567890abcdef'
      createDueProofPrompt(userId, runId)
      track(
        spyOn(proactiveLlmModule, 'dispatchExecution').mockImplementation(() => Promise.resolve('Persisted reply.')),
      )

      await pollScheduledOnce(chat, () => createMockProvider())

      const storePath = join(envDir, 'proof-checks.jsonl')
      await waitFor(() => {
        try {
          return readFileSync(storePath, 'utf8').includes(`"runId":"${runId}"`)
        } catch {
          return false
        }
      })
      const parsed: unknown = JSON.parse(readFileSync(storePath, 'utf8').trim())
      expect(parsed).toMatchObject({ runId, responseText: 'Persisted reply.', delivered: true })
      expect(readFileSync(storePath, 'utf8').trim()).toMatch(/"at":"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/u)
    })
  })
})
