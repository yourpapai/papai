// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { DebugEvent } from '../../src/debug/event-bus.js'
import type { LlmTrace } from '../../src/debug/llm-trace-collector.js'
import {
  observeAsyncRun,
  recordProofDelivery,
  resetProofDeliveryRecords,
  type AsyncRunState,
} from '../../src/deferred-prompts/proof-checks-observe.js'
import type { ProofCheckDeps, ProofCheckRequest } from '../../src/deferred-prompts/proof-checks.js'
import type { ProofCheckRecord } from '../../src/deferred-prompts/proof-store.js'
import type { CancelResult, CreateResult, ScheduledPrompt } from '../../src/deferred-prompts/types.js'
import { flushMicrotasks, mockLogger, setupTestDb, waitFor } from '../utils/test-helpers.js'

const CLOCK_BASE_MS = 1_700_000_040_000
const MINUTE_MS = 60_000
const OWNER = 'sc-admin'
const CHAT_USER = 'chat-admin'
const PROOF_ID = 'sp-proof'

interface FakeClock {
  nowMs: number
  delays: number[]
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (handle: unknown) => void
  advance: (ms: number) => void
  pendingCount: () => number
}

const makeFakeClock = (startMs = CLOCK_BASE_MS): FakeClock => {
  const entries = new Map<unknown, { fn: () => void; at: number; cleared: boolean }>()
  let seq = 0
  const clock: FakeClock = {
    nowMs: startMs,
    delays: [],
    setTimeout: (fn: () => void, ms: number): unknown => {
      const id = ++seq
      clock.delays.push(ms)
      entries.set(id, { fn, at: clock.nowMs + ms, cleared: false })
      return id
    },
    clearTimeout: (handle: unknown): void => {
      const entry = entries.get(handle)
      if (entry !== undefined) entry.cleared = true
    },
    advance: (ms: number): void => {
      const target = clock.nowMs + ms
      for (;;) {
        const due = [...entries.entries()]
          .filter(([, entry]) => !entry.cleared && entry.at <= target)
          .sort((a, b) => a[1].at - b[1].at)[0]
        if (due === undefined) break
        clock.nowMs = Math.max(clock.nowMs, due[1].at)
        entries.delete(due[0])
        due[1].fn()
      }
      clock.nowMs = target
    },
    pendingCount: (): number => [...entries.values()].filter((entry) => !entry.cleared).length,
  }
  return clock
}

interface FakeBus {
  listeners: Set<(event: DebugEvent) => void>
  subscribe: (listener: (event: DebugEvent) => void) => void
  unsubscribe: (listener: (event: DebugEvent) => void) => void
  emitUserPromptEvent: (type: string, promptId: string, at: number) => void
  emitGroupPromptEvent: (type: string, promptId: string, at: number) => void
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
    emitUserPromptEvent: (type: string, promptId: string, at: number): void => {
      emit({ type, timestamp: at, scope: { kind: 'user', userId: OWNER }, data: { promptId } })
    },
    emitGroupPromptEvent: (type: string, promptId: string, at: number): void => {
      emit({ type, timestamp: at, scope: { kind: 'group', groupId: 'group-1' }, data: { promptId } })
    },
  }
}

interface Observed {
  clock: FakeClock
  bus: FakeBus
  records: ProofCheckRecord[]
  cancelCalls: string[]
  releaseLock: () => void
  releaseCalls: () => number
  deps: ProofCheckDeps
}

const makeObserved = (overrides: Partial<ProofCheckDeps> = {}): Observed => {
  const clock = makeFakeClock()
  const bus = makeFakeBus()
  const records: ProofCheckRecord[] = []
  const cancelCalls: string[] = []
  let releaseCalls = 0
  const observed: Observed = {
    clock,
    bus,
    records,
    cancelCalls,
    releaseLock: (): void => {
      releaseCalls += 1
    },
    releaseCalls: () => releaseCalls,
    deps: {
      now: () => clock.nowMs,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      subscribe: bus.subscribe,
      unsubscribe: bus.unsubscribe,
      executeCreate: (): CreateResult => ({ error: 'unused' }),
      executeUpdate: () => ({ error: 'unused' }),
      executeGet: () => ({ error: 'unused' }),
      executeCancel: (_userId: string, input: { id: string }): CancelResult => {
        cancelCalls.push(input.id)
        return { status: 'cancelled', id: input.id }
      },
      listScheduledPrompts: () => [],
      listAlertPrompts: () => [],
      getScheduledPrompt: () => null,
      getAlertPrompt: () => null,
      store: {
        append: (record: ProofCheckRecord): Promise<void> => {
          records.push(record)
          return Promise.resolve()
        },
        load: () => Promise.resolve([]),
      },
      readRecentLlm: () => [],
      readCachedHistory: () => [],
      ...overrides,
    },
  }
  return observed
}

const makeState = (overrides: Partial<AsyncRunState> = {}): AsyncRunState => ({
  runId: 'run-1',
  checkId: 'bug3_fires_on_creation',
  variant: undefined,
  startMs: CLOCK_BASE_MS,
  fireAtMs: CLOCK_BASE_MS + 10 * MINUTE_MS,
  isAlertVariant: false,
  executions: [],
  ...overrides,
})

const makeRequest = (): ProofCheckRequest => ({ storageContextId: OWNER, chatUserId: CHAT_USER })

const makeScheduledRow = (executedAtMs: number): ScheduledPrompt => ({
  type: 'scheduled',
  id: PROOF_ID,
  createdByUserId: OWNER,
  createdByUsername: null,
  deliveryTarget: {
    contextId: OWNER,
    contextType: 'dm',
    threadId: null,
    audience: 'personal',
    mentionUserIds: [],
    createdByUserId: OWNER,
    createdByUsername: null,
    storageContextId: OWNER,
  },
  prompt: 'proof prompt',
  fireAt: new Date(CLOCK_BASE_MS).toISOString(),
  rrule: null,
  dtstartUtc: null,
  timezone: null,
  status: 'active',
  createdAt: new Date(CLOCK_BASE_MS).toISOString(),
  lastExecutedAt: new Date(executedAtMs).toISOString(),
  executionMetadata: { delivery_brief: '', context_snapshot: null },
})

const makeTrace = (overrides: Partial<LlmTrace> & Pick<LlmTrace, 'timestamp'>): LlmTrace => ({
  userId: OWNER,
  chatUserId: CHAT_USER,
  model: 'test-model',
  steps: 1,
  totalTokens: { inputTokens: 0, outputTokens: 0 },
  duration: 0,
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
  stepsDetail: undefined,
  ...overrides,
})

describe('proof check async observation', () => {
  let observed: Observed
  let state: AsyncRunState
  let envDir: string
  let originalDbPath: string | undefined

  const arm = (stateOverrides: Partial<AsyncRunState> = {}, depsOverrides: Partial<ProofCheckDeps> = {}): void => {
    observed = makeObserved(depsOverrides)
    state = makeState(stateOverrides)
    observeAsyncRun(observed.deps, makeRequest(), state, PROOF_ID, 2 * 60_000, observed.releaseLock)
  }

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    resetProofDeliveryRecords()
    envDir = mkdtempSync(join(tmpdir(), 'papai-proof-observe-'))
    originalDbPath = process.env['DB_PATH']
    process.env['DB_PATH'] = join(envDir, 'papai.db')
  })

  afterEach(() => {
    if (originalDbPath === undefined) delete process.env['DB_PATH']
    else process.env['DB_PATH'] = originalDbPath
    rmSync(envDir, { recursive: true, force: true })
  })

  test('a matching user-scope fired event records the execution, tears down, and releases the lock once', async () => {
    const executionMs = CLOCK_BASE_MS + 9 * MINUTE_MS
    arm()
    observed.clock.nowMs = executionMs

    observed.bus.emitUserPromptEvent('deferred:fired', 'other-prompt', executionMs)
    await flushMicrotasks()
    observed.bus.emitGroupPromptEvent('deferred:fired', PROOF_ID, executionMs)
    await flushMicrotasks()
    expect(observed.records).toHaveLength(0)
    expect(observed.bus.listeners.size).toBe(1)

    observed.bus.emitUserPromptEvent('deferred:fired', PROOF_ID, executionMs)
    await waitFor(() => observed.records.length > 0)
    await waitFor(() => observed.releaseCalls() > 0)

    expect(observed.records[0]?.run_id).toBe('run-1')
    expect(observed.records[0]?.observations[0]).toBe('trigger: event')
    expect(observed.records[0]?.verdict).toBe('fail')
    expect(state.executions).toEqual([executionMs])
    expect(observed.bus.listeners.size).toBe(0)
    expect(observed.clock.pendingCount()).toBe(0)
    expect(observed.cancelCalls).toEqual([PROOF_ID])
    expect(observed.releaseCalls()).toBe(1)

    observed.bus.emitUserPromptEvent('deferred:fired', PROOF_ID, executionMs)
    await flushMicrotasks()
    expect(observed.records).toHaveLength(1)
    expect(observed.releaseCalls()).toBe(1)
  })

  test('deferred:alerted drives the alert-variant state and any execution inside the window fails', async () => {
    arm({ checkId: 'bug3_fires_on_creation', isAlertVariant: true, fireAtMs: null, variant: 'alert' })
    const executionMs = CLOCK_BASE_MS + MINUTE_MS
    observed.clock.nowMs = executionMs

    observed.bus.emitUserPromptEvent('deferred:alerted', PROOF_ID, executionMs)
    await waitFor(() => observed.records.length > 0)
    await waitFor(() => observed.releaseCalls() > 0)

    expect(observed.records[0]?.verdict).toBe('fail')
    expect(observed.records[0]?.observations.join('\n')).toContain('executions_inside_window: 1')
    expect(observed.cancelCalls).toEqual([PROOF_ID])
    expect(observed.bus.listeners.size).toBe(0)
    expect(observed.releaseCalls()).toBe(1)
  })

  test('the timeout path finalizes through the row-read fallback and unsubscribes the listener', async () => {
    const executedAtMs = CLOCK_BASE_MS + 30_000
    const row: ScheduledPrompt = {
      type: 'scheduled',
      id: PROOF_ID,
      createdByUserId: OWNER,
      createdByUsername: null,
      deliveryTarget: {
        contextId: OWNER,
        contextType: 'dm',
        threadId: null,
        audience: 'personal',
        mentionUserIds: [],
        createdByUserId: OWNER,
        createdByUsername: null,
        storageContextId: OWNER,
      },
      prompt: 'proof prompt',
      fireAt: new Date(CLOCK_BASE_MS).toISOString(),
      rrule: null,
      dtstartUtc: null,
      timezone: null,
      status: 'active',
      createdAt: new Date(CLOCK_BASE_MS).toISOString(),
      lastExecutedAt: new Date(executedAtMs).toISOString(),
      executionMetadata: { delivery_brief: '', context_snapshot: null },
    }
    arm({}, { getScheduledPrompt: (): ScheduledPrompt | null => row })

    observed.clock.advance(2 * 60_000 + 1_000)
    await waitFor(() => observed.records.length > 0)
    await waitFor(() => observed.releaseCalls() > 0)

    expect(observed.records[0]?.observations[0]).toBe('trigger: timeout')
    expect(observed.records[0]?.verdict).toBe('fail')
    expect(state.executions).toEqual([executedAtMs])
    expect(observed.bus.listeners.size).toBe(0)
    expect(observed.cancelCalls).toEqual([PROOF_ID])
    expect(observed.releaseCalls()).toBe(1)
  })

  test('timeout-path trace correlation anchors at the observed execution and ignores later unrelated turns', async () => {
    const executedAtMs = CLOCK_BASE_MS + 500
    const row = makeScheduledRow(executedAtMs)
    const preStartTrace = makeTrace({ timestamp: CLOCK_BASE_MS - 1, generatedText: 'pre-start turn' })
    const proofTrace = makeTrace({ timestamp: executedAtMs + 1_000, generatedText: 'proof reply' })
    const unrelatedTrace = makeTrace({ timestamp: executedAtMs + 20_000, generatedText: 'unrelated admin turn' })
    recordProofDelivery('run-1', 'proof reply', new Date(CLOCK_BASE_MS).toISOString())
    arm(
      { checkId: 'bug1_delivery_matches_execution', variant: 'no_tools' },
      {
        getScheduledPrompt: (): ScheduledPrompt | null => row,
        readRecentLlm: () => [preStartTrace, proofTrace, unrelatedTrace],
      },
    )

    observed.clock.advance(2 * 60_000 + 1_000)
    await waitFor(() => observed.records.length > 0)
    await waitFor(() => observed.releaseCalls() > 0)

    expect(observed.records[0]?.verdict).toBe('pass')
    expect(observed.records[0]?.observations.join('\n')).toContain('generated_text: proof reply')
  })

  test('event-path trace correlation picks the proof turn that completed before the fired event', async () => {
    const fireMs = CLOCK_BASE_MS + 90_000
    const earlierUnrelated = makeTrace({ timestamp: CLOCK_BASE_MS + 30_000, generatedText: 'earlier admin turn' })
    const foreignUserTrace = makeTrace({
      timestamp: fireMs - 500,
      chatUserId: 'someone-else',
      generatedText: 'foreign turn',
    })
    const proofTrace = makeTrace({ timestamp: fireMs - 1_000, generatedText: 'proof reply' })
    recordProofDelivery('run-1', 'proof reply', new Date(CLOCK_BASE_MS).toISOString())
    arm(
      { checkId: 'bug1_delivery_matches_execution', variant: 'no_tools' },
      { readRecentLlm: () => [earlierUnrelated, foreignUserTrace, proofTrace] },
    )

    observed.clock.nowMs = fireMs
    observed.bus.emitUserPromptEvent('deferred:fired', PROOF_ID, fireMs)
    await waitFor(() => observed.records.length > 0)
    await waitFor(() => observed.releaseCalls() > 0)

    expect(observed.records[0]?.verdict).toBe('pass')
    expect(observed.records[0]?.observations.join('\n')).toContain('generated_text: proof reply')
  })

  test('an observation error records an inconclusive verdict and still tears down', async () => {
    arm(
      {},
      {
        getScheduledPrompt: (): ScheduledPrompt | null => {
          throw new Error('row read exploded')
        },
      },
    )

    observed.clock.advance(2 * 60_000 + 1_000)
    await waitFor(() => observed.records.length > 0)
    await waitFor(() => observed.releaseCalls() > 0)

    expect(observed.records[0]?.verdict).toBe('inconclusive')
    expect(observed.records[0]?.observations.join('\n')).toContain('observation_error: row read exploded')
    expect(observed.bus.listeners.size).toBe(0)
    expect(observed.clock.pendingCount()).toBe(0)
    expect(observed.cancelCalls).toEqual([PROOF_ID])
    expect(observed.releaseCalls()).toBe(1)
  })

  test('recordProofDelivery persists the delivery line next to the database and reset clears the map', async () => {
    recordProofDelivery('run-9', 'delivered text', new Date(CLOCK_BASE_MS).toISOString())
    const path = join(envDir, 'proof-checks.jsonl')
    await waitFor(() => {
      try {
        return readFileSync(path, 'utf8').includes('"runId":"run-9"')
      } catch {
        return false
      }
    })
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8').trim())
    expect(parsed).toEqual({
      runId: 'run-9',
      responseText: 'delivered text',
      delivered: true,
      at: new Date(CLOCK_BASE_MS).toISOString(),
    })
    resetProofDeliveryRecords()
  })
})
