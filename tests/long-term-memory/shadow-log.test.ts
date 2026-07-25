// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { ModelMessage } from 'ai'

import type { ResolvedStreamTextResult } from '../../src/llm-orchestrator-events.js'
import type { ShadowLogRow } from '../../src/long-term-memory/shadow-log-row.js'
import {
  scheduleShadowRecallLog,
  type ScheduleShadowRecallLogArgs,
  type ScheduleShadowRecallLogDeps,
} from '../../src/long-term-memory/shadow-log.js'
import type { RunShadowRecallResult } from '../../src/long-term-memory/shadow-recall.js'
import { keyedHash } from '../../src/stats/hashing.js'
import { createTrackedLoggerMock, type TrackedLoggerMock } from '../utils/logger-mock.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

type ShadowLogModule = typeof import('../../src/long-term-memory/shadow-log.js')

/** `shadow-log.ts` binds `const log = logger.child(...)` at module load (mirrors the
 * `tests/coding-credentials/redaction-log.test.ts` note), so asserting on the logger
 * requires installing the mock *before* importing a fresh copy of the module through a
 * cachebuster query — the already-statically-imported `scheduleShadowRecallLog` above
 * stays bound to whichever logger was live at file-load time. */
const importShadowLogFresh = (): Promise<ShadowLogModule> =>
  import(`../../src/long-term-memory/shadow-log.js?test=${crypto.randomUUID()}`)

/** Yields the microtask queue repeatedly so any promise-chain scheduled inside a
 * `queueMicrotask` callback (including further awaited promises) has a chance to settle,
 * without relying on wall-clock timers. */
async function flushMicrotasks(times = 20): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve()
  }
}

const baseMessages: ModelMessage[] = [
  { role: 'user', content: 'what did we decide about the pricing rollout last week' },
]

const baseSteps: ResolvedStreamTextResult['steps'] = [
  {
    toolCalls: [{ toolName: 'search_memory', toolCallId: 'call-1', input: { query: 'pricing rollout decision' } }],
    toolResults: [{ toolCallId: 'call-1', output: { records: [{ id: 'record-beta' }, { id: 'record-gamma' }] } }],
  },
]

const baseArgs: ScheduleShadowRecallLogArgs = {
  contextId: 'thread-42-config-context',
  configId: 'config-ctx-1',
  contextType: 'group',
  readerModelId: 'gpt-4o-mini',
  turnRef: 'turn-1234',
  messages: baseMessages,
  steps: baseSteps,
}

const shadowRecallResult: RunShadowRecallResult = {
  hits: [
    { id: 'record-alpha', score: 0.91, provenance: 'current' },
    { id: 'record-beta', score: 0.42, provenance: 'group' },
  ],
  activeRecordCount: 7,
}

function buildSpyDeps(overrides: Partial<ScheduleShadowRecallLogDeps> = {}): {
  deps: ScheduleShadowRecallLogDeps
  calls: string[]
  insertedRows: ShadowLogRow[]
} {
  const calls: string[] = []
  const insertedRows: ShadowLogRow[] = []
  const deps: ScheduleShadowRecallLogDeps = {
    isShadowLoggingEnabled: mock(() => {
      calls.push('isShadowLoggingEnabled')
      return true
    }),
    shadowSampleRate: mock(() => {
      calls.push('shadowSampleRate')
      return 1
    }),
    shouldSampleTurn: mock(() => {
      calls.push('shouldSampleTurn')
      return true
    }),
    runShadowRecall: mock(() => {
      calls.push('runShadowRecall')
      return Promise.resolve(shadowRecallResult)
    }),
    extractSearchMemoryPulls: mock((steps: ResolvedStreamTextResult['steps']) => {
      calls.push('extractSearchMemoryPulls')
      return {
        pulled: steps.length > 0,
        pullCount: steps.reduce((n, s) => n + s.toolCalls.length, 0),
        queries: [],
        resultIds: [],
      }
    }),
    buildShadowLogRow: mock(() => {
      calls.push('buildShadowLogRow')
      return {
        scopeHash: 'x',
        contextHash: 'x',
        turnRef: baseArgs.turnRef,
        readerModelId: baseArgs.readerModelId,
        activeRecordCount: 0,
        shadowQueryHash: 'x',
        shadowQueryLenBucket: 'short',
        shadowHitCount: 0,
        shadowTopScore: null,
        shadowTopProvenance: null,
        shadowTopRecordHash: null,
        modelPulled: false,
        pullCount: 0,
        pullQueryHash: null,
        pullResultCount: 0,
        shadowPullOverlap: 0,
        skippedReason: null,
      } satisfies ShadowLogRow
    }),
    insertShadowLogRow: mock((row: ShadowLogRow) => {
      calls.push('insertShadowLogRow')
      insertedRows.push(row)
    }),
    ...overrides,
  }
  return { deps, calls, insertedRows }
}

describe('scheduleShadowRecallLog', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('off hot path: returns synchronously before any dep runs; deps run only after a microtask flush', async () => {
    const { deps, calls } = buildSpyDeps()

    const returned = scheduleShadowRecallLog(baseArgs, deps)

    expect(returned).toBeUndefined()
    expect(calls).toEqual([])

    await flushMicrotasks()

    expect(calls.length).toBeGreaterThan(0)
    expect(calls).toContain('insertShadowLogRow')
  })

  test('kill switch OFF: no recall run, no row written', async () => {
    const { deps, calls } = buildSpyDeps({ isShadowLoggingEnabled: mock(() => false) })

    scheduleShadowRecallLog(baseArgs, deps)
    await flushMicrotasks()

    expect(calls).not.toContain('runShadowRecall')
    expect(calls).not.toContain('insertShadowLogRow')
  })

  test('sampler excludes the turn: no recall run, no row written', async () => {
    const { deps, calls } = buildSpyDeps({ shouldSampleTurn: mock(() => false) })

    scheduleShadowRecallLog(baseArgs, deps)
    await flushMicrotasks()

    expect(calls).not.toContain('runShadowRecall')
    expect(calls).not.toContain('insertShadowLogRow')
  })

  test('a thrown/rejected error inside the microtask is swallowed: no rethrow, no row written', async () => {
    const { deps, calls } = buildSpyDeps({
      runShadowRecall: mock(() => Promise.reject(new Error('boom'))),
    })

    expect(() => scheduleShadowRecallLog(baseArgs, deps)).not.toThrow()
    await flushMicrotasks()

    expect(calls).not.toContain('insertShadowLogRow')
  })

  describe('swallowed failures are observable via a warn log (not just non-throwing)', () => {
    const tracked: TrackedLoggerMock = createTrackedLoggerMock()

    beforeEach(() => {
      tracked.clearCalls()
      void mock.module('../../src/logger.js', () => ({
        getLogLevel: (): string => 'info',
        logger: tracked.logger,
      }))
    })

    test('an async rejection from runShadowRecall is logged at warn', async () => {
      const { scheduleShadowRecallLog: freshSchedule } = await importShadowLogFresh()
      const { deps } = buildSpyDeps({
        runShadowRecall: mock(() => Promise.reject(new Error('boom'))),
      })

      freshSchedule(baseArgs, deps)
      await flushMicrotasks()

      const warnCalls = tracked.getCallsByLevel('warn')
      expect(warnCalls.length).toBeGreaterThan(0)
    })

    test('a synchronous throw from insertShadowLogRow is swallowed and logged at warn', async () => {
      const { scheduleShadowRecallLog: freshSchedule } = await importShadowLogFresh()
      const insertCalls: string[] = []
      const { deps } = buildSpyDeps({
        insertShadowLogRow: mock(() => {
          insertCalls.push('insertShadowLogRow')
          throw new Error('sync-boom')
        }),
      })

      expect(() => freshSchedule(baseArgs, deps)).not.toThrow()
      await flushMicrotasks()

      expect(insertCalls).toContain('insertShadowLogRow')
      const warnCalls = tracked.getCallsByLevel('warn')
      expect(warnCalls.length).toBeGreaterThan(0)
    })
  })

  describe('full sampled turn (real leaf modules for hashing/overlap)', () => {
    let realDeps: ScheduleShadowRecallLogDeps
    let insertedRows: ShadowLogRow[]

    beforeEach(async () => {
      await setupTestDb()
      insertedRows = []
      const { buildShadowLogRow } = await import('../../src/long-term-memory/shadow-log-row.js')
      const { extractSearchMemoryPulls } = await import('../../src/long-term-memory/shadow-pull-extract.js')
      realDeps = {
        isShadowLoggingEnabled: (): boolean => true,
        shadowSampleRate: (): number => 1,
        shouldSampleTurn: (): boolean => true,
        runShadowRecall: (): Promise<RunShadowRecallResult> => Promise.resolve(shadowRecallResult),
        extractSearchMemoryPulls,
        buildShadowLogRow,
        insertShadowLogRow: (row): void => {
          insertedRows.push(row)
        },
      }
    })

    test('writes exactly one row whose hashes match keyedHash of the inputs', async () => {
      scheduleShadowRecallLog(baseArgs, realDeps)
      await flushMicrotasks()

      expect(insertedRows).toHaveLength(1)
      expect(insertedRows[0]).toBeDefined()
      expect(insertedRows[0]?.contextHash).toBe(keyedHash(baseArgs.contextId))
      expect(insertedRows[0]?.shadowQueryHash).toBe(keyedHash('what did we decide about the pricing rollout last week'))
      expect(insertedRows[0]?.scopeHash).toBe(keyedHash(`group:${baseArgs.contextId}`))
      expect(insertedRows[0]?.turnRef).toBe(baseArgs.turnRef)
      expect(insertedRows[0]?.readerModelId).toBe(baseArgs.readerModelId)
    })

    test('model_pulled and shadow_pull_overlap reflect the steps', async () => {
      scheduleShadowRecallLog(baseArgs, realDeps)
      await flushMicrotasks()

      expect(insertedRows).toHaveLength(1)
      expect(insertedRows[0]).toBeDefined()

      // steps carry one search_memory pull returning record-beta and record-gamma;
      // shadow hits are record-alpha and record-beta -> overlap 1.
      expect(insertedRows[0]?.modelPulled).toBe(true)
      expect(insertedRows[0]?.pullCount).toBe(1)
      expect(insertedRows[0]?.shadowPullOverlap).toBe(1)
      expect(insertedRows[0]?.shadowHitCount).toBe(2)
      expect(insertedRows[0]?.activeRecordCount).toBe(7)
    })
  })
})
