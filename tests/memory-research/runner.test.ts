// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { candidateVersions } from '../../scripts/memory-research/candidate-registry.js'
import { createCorrectedHybridCandidate } from '../../scripts/memory-research/candidates/corrected-hybrid.js'
import { memoryScenarios } from '../../scripts/memory-research/corpus.js'
import type { ImportedPublicDataset } from '../../scripts/memory-research/importers.js'
import { aggregateWorkerResources } from '../../scripts/memory-research/report-resources.js'
import { evaluateQuery, retrieveWithDeadline } from '../../scripts/memory-research/runner-query.js'
import {
  executeScenarioJob,
  materializeScenarioWorkload,
  runIsolatedScenarioJob,
  runResearchExperiment,
  runSequentially,
  selectScenarioSplit,
} from '../../scripts/memory-research/runner.js'
import { EvidenceIdSchema, MemoryHitSchema } from '../../scripts/memory-research/types.js'
import type {
  AssembledContext,
  ForgetResult,
  IngestResult,
  MemoryCandidateAdapter,
  MemoryEvent,
  MemoryHit,
  MemoryScenario,
  OperationalMemoryQuery,
  RawQueryResult,
  ResourceMetrics,
  SliceLabel,
} from '../../scripts/memory-research/types.js'

const developmentScenario = (label: SliceLabel): MemoryScenario =>
  memoryScenarios.find(({ labels, split }) => split === 'development' && labels.includes(label))!

const neverCompletes = (): Promise<RawQueryResult> =>
  new Promise(() => {
    // The runner deadline must settle this deliberately pending operation.
  })

const emptySuccess = (query: OperationalMemoryQuery): Promise<RawQueryResult> =>
  Promise.resolve({
    status: 'success',
    queryId: query.queryId,
    hits: [],
    latencyMs: 1,
  })

const syntheticHit = (query: OperationalMemoryQuery, index: number, rank = index + 1): MemoryHit =>
  MemoryHitSchema.parse({
    evidenceId: `evidence-raw-hit-${index + 1}`,
    sourceEventId: `event-raw-hit-${index + 1}`,
    scope: query.authorizedScope,
    score: { lexical: 1, dense: 0, graph: 0, recency: 0, total: 1 },
    rank,
    content: `Synthetic raw hit ${index + 1}`,
    validity: { validFrom: '2026-01-01T00:00:00.000Z', validTo: null },
    provenance: { kind: 'canonical', derivedFromEvidenceIds: [] },
  })

type InvalidHitCase = readonly [string, (query: OperationalMemoryQuery) => readonly MemoryHit[]]

const invalidHitCases = [
  [
    'more hits than k',
    (query): readonly MemoryHit[] => Array.from({ length: query.k + 1 }, (_, index) => syntheticHit(query, index)),
  ],
  ['duplicate evidence IDs', (query): readonly MemoryHit[] => [syntheticHit(query, 0, 1), syntheticHit(query, 0, 2)]],
  ['non-contiguous ranks', (query): readonly MemoryHit[] => [syntheticHit(query, 0, 1), syntheticHit(query, 1, 3)]],
  [
    'ranks that disagree with output order',
    (query): readonly MemoryHit[] => [syntheticHit(query, 0, 2), syntheticHit(query, 1, 1)],
  ],
  [
    'oversized provenance',
    (query): readonly MemoryHit[] => [
      {
        ...syntheticHit(query, 0),
        provenance: {
          kind: 'derived',
          derivedFromEvidenceIds: Array.from({ length: 65 }, (_, index) =>
            EvidenceIdSchema.parse(`evidence-oversized-provenance-${index}`),
          ),
        },
      },
    ],
  ],
  ['oversized content', (query): readonly MemoryHit[] => [{ ...syntheticHit(query, 0), content: 'x'.repeat(16_385) }]],
] as const satisfies readonly InvalidHitCase[]

const validatedLongMemEval = {
  datasetId: 'longmemeval',
  profile: 'longmemeval-cleaned-v1',
  sourceSha256: '1'.repeat(64),
  cases: [
    {
      caseId: 'public-case',
      sourceRecordIndex: 0,
      category: 'single-session-user',
      sessions: [
        {
          sessionId: 'session-1',
          timestamp: '2026-01-01',
          messages: [
            {
              messageId: 'message-1',
              role: 'user',
              speaker: null,
              content: 'Remember this.',
              officialEvidence: true,
            },
          ],
        },
      ],
      questions: [
        {
          questionId: 'question-1',
          text: 'What should be remembered?',
          timestamp: '2026-01-02',
          category: 'single-session-user',
          abstention: false,
          officialAnswers: ['Remember this.'],
          officialChoices: null,
          officialEvidenceRefs: ['session-1'],
          evidenceGranularity: 'session',
        },
      ],
    },
  ],
  importStatus: 'validated',
  protocolStatus: 'not_run',
} as const satisfies ImportedPublicDataset

const fakeCandidate = (
  retrieve: (query: OperationalMemoryQuery) => Promise<RawQueryResult>,
  identity: Readonly<{
    candidateId: MemoryCandidateAdapter['candidateId']
    version: string
  }> = {
    candidateId: 'corrected-hybrid',
    version: candidateVersions['corrected-hybrid'],
  },
): MemoryCandidateAdapter => ({
  candidateId: identity.candidateId,
  version: identity.version,
  reset: (): Promise<void> => Promise.resolve(),
  ingest: (events: readonly MemoryEvent[]): Promise<IngestResult> =>
    Promise.resolve({ ingestedEventCount: events.length, durationMs: 1 }),
  retrieve,
  assembleContext: (_query, hits): Promise<AssembledContext> =>
    Promise.resolve({
      text: hits.map(({ content }) => content).join('\n'),
      tokenCount: hits.length,
      evidenceIds: hits.map(({ evidenceId }) => evidenceId),
    }),
  forget: (request): Promise<ForgetResult> =>
    Promise.resolve({
      erasedEvidenceIds: request.kind === 'evidence' ? request.evidenceIds : [],
      completedAt: request.completedAt,
    }),
  rebuild: (): Promise<void> => Promise.resolve(),
  resourceMetrics: (): Promise<ResourceMetrics> =>
    Promise.resolve({
      ingestedEventCount: 1000,
      ingestDurationMs: 10,
      ingestThroughputPerSecond: 100_000,
      retrievalCount: 1,
      modelCallCount: 0,
      extractorCallCount: 0,
      storedBytes: 1000,
      incrementalRssBytes: 1000,
    }),
})

const candidateWithResources = (
  name: string,
  calls: string[],
  resourceMetrics: () => Promise<ResourceMetrics>,
): MemoryCandidateAdapter => {
  const base = fakeCandidate(emptySuccess)
  let resetCount = 0
  return {
    ...base,
    reset: (): Promise<void> => {
      resetCount += 1
      calls.push(`${name}:reset:${resetCount}`)
      return Promise.resolve()
    },
    resourceMetrics: (): Promise<ResourceMetrics> => {
      calls.push(`${name}:resources`)
      return resourceMetrics()
    },
  }
}

describe('runner selection and workloads', () => {
  test('sorts a closed split and rejects cross-split evidence references', () => {
    const selected = selectScenarioSplit(memoryScenarios, 'development')
    const sealedEvidenceId = selectScenarioSplit(memoryScenarios, 'sealed-test')[0]!.events[0]!.evidenceId
    const original = selected[0]!
    const malicious = {
      ...original,
      queries: [
        {
          ...original.queries[0]!,
          expectedEvidenceIds: [sealedEvidenceId],
        },
      ],
    }

    expect(selected).toHaveLength(60)
    expect(selected.map(({ scenarioId }) => scenarioId)).toEqual(selected.map(({ scenarioId }) => scenarioId).sort())
    expect(() => selectScenarioSplit([malicious, ...memoryScenarios.slice(1)], 'development')).toThrow(
      'selection closure',
    )
  })

  test('materializes exactly N unique rows in every exact scope including canonical rows', () => {
    const scenario = developmentScenario('cross-scope')
    const workload = materializeScenarioWorkload(scenario, 1000, 20260723)

    expect(workload.scopeRecordCounts).toHaveLength(2)
    expect(workload.scopeRecordCounts.map(({ count }) => count)).toEqual([1000, 1000])
    expect(workload.recordedEvents.map(({ eventId }) => eventId)).toEqual([...scenario.faults.ingestOrder])
    expect(Math.max(...workload.scaleEvents.map(({ eventTime }) => Date.parse(eventTime)))).toBeLessThan(
      Math.min(...scenario.events.map(({ eventTime }) => Date.parse(eventTime))),
    )
  })
})

describe('scenario lifecycle execution', () => {
  test('keeps evaluator ground truth outside candidate retrieval and context assembly', async () => {
    const scenario = developmentScenario('direct-fact')
    const query = scenario.queries[0]!
    const expectedEvidenceId = query.expectedEvidenceIds[0]!
    const expectedEvent = scenario.events.find(({ evidenceId }) => evidenceId === expectedEvidenceId)!
    const expectedHit = MemoryHitSchema.parse({
      evidenceId: expectedEvidenceId,
      sourceEventId: expectedEvent.eventId,
      scope: expectedEvent.scope,
      score: { lexical: 1, dense: 0, graph: 0, recency: 0, total: 1 },
      rank: 1,
      content: expectedEvent.content,
      validity: expectedEvent.validity,
      provenance: { kind: 'canonical', derivedFromEvidenceIds: [] },
    })
    const observedQueries: object[] = []
    const base = fakeCandidate((receivedQuery) => {
      observedQueries.push(receivedQuery)
      return Promise.resolve({
        status: 'success',
        queryId: receivedQuery.queryId,
        hits: [expectedHit],
        latencyMs: 1,
      })
    })
    const candidate: MemoryCandidateAdapter = {
      ...base,
      assembleContext: (receivedQuery): Promise<AssembledContext> => {
        observedQueries.push(receivedQuery)
        return Promise.resolve({ text: '', tokenCount: 0, evidenceIds: [] })
      },
    }

    const result = await evaluateQuery(candidate, query, 1000, (): number => performance.now())

    expect(observedQueries).toHaveLength(2)
    expect(observedQueries.map((receivedQuery) => Object.keys(receivedQuery).sort())).toEqual([
      ['actorRole', 'authorizedScope', 'contextTokenBudget', 'k', 'language', 'queryId', 'queryTime', 'text'],
      ['actorRole', 'authorizedScope', 'contextTokenBudget', 'k', 'language', 'queryId', 'queryTime', 'text'],
    ])
    expect(result.evaluation.query).toEqual(query)
    expect(result.evaluation.query.expectedEvidenceIds).toEqual(query.expectedEvidenceIds)
    expect(result.evaluation.metrics).toMatchObject({ precisionAtK: 1, recallAtK: 1 })
  })

  test('retains evaluator diagnostics without redefining legacy query metrics', async () => {
    const crossScopeQuery = developmentScenario('cross-scope').queries[0]!
    const forbiddenEvidenceId = crossScopeQuery.forbiddenEvidenceIds[0]!
    const relabeledForeignHit = MemoryHitSchema.parse({
      ...syntheticHit(crossScopeQuery, 0),
      evidenceId: forbiddenEvidenceId,
      scope: crossScopeQuery.authorizedScope,
    })
    const scopeEvaluation = await evaluateQuery(
      fakeCandidate(() =>
        Promise.resolve({
          status: 'success',
          queryId: crossScopeQuery.queryId,
          hits: [relabeledForeignHit],
          latencyMs: 1,
        }),
      ),
      crossScopeQuery,
      1000,
      (): number => performance.now(),
    )

    const erasureQuery = developmentScenario('erasure-non-recapture').queries[0]!
    const erasedEvidenceId = erasureQuery.erasedEvidenceIds[0]!
    const derivedHit = MemoryHitSchema.parse({
      ...syntheticHit(erasureQuery, 0),
      provenance: { kind: 'derived', derivedFromEvidenceIds: [erasedEvidenceId] },
    })
    const erasureEvaluation = await evaluateQuery(
      fakeCandidate(() =>
        Promise.resolve({
          status: 'success',
          queryId: erasureQuery.queryId,
          hits: [derivedHit],
          latencyMs: 1,
        }),
      ),
      erasureQuery,
      1000,
      (): number => performance.now(),
    )

    expect(scopeEvaluation.evaluation.metrics.leakageCount).toBe(0)
    expect(scopeEvaluation.evaluation.diagnostics.forbiddenHitCount).toBe(1)
    expect(erasureEvaluation.evaluation.metrics.erasedHitCount).toBe(0)
    expect(erasureEvaluation.evaluation.diagnostics.erasedHitCount).toBe(0)
  })

  test('retains setup failures instead of running an injected adapter registered as another candidate', async () => {
    const scenario = developmentScenario('direct-fact')
    let retrievalCount = 0
    const result = await executeScenarioJob(
      {
        candidateId: 'corrected-hybrid',
        scenario,
        scale: 1000,
        seed: 20260723,
        queryTimeoutMs: 1000,
      },
      {
        createCandidate: () =>
          fakeCandidate(
            (query) => {
              retrievalCount += 1
              return emptySuccess(query)
            },
            {
              candidateId: 'as-shipped',
              version: candidateVersions['as-shipped'],
            },
          ),
      },
    )

    expect(retrievalCount).toBe(0)
    expect(result.candidateId).toBe('corrected-hybrid')
    expect(result.candidateVersion).toBe(candidateVersions['corrected-hybrid'])
    expect(result.scenario.queries).toHaveLength(scenario.queries.length)
    expect(result.failures).toHaveLength(scenario.queries.length)
    expect(result.failures[0]).toMatchObject({
      stage: 'setup',
      kind: 'validation',
    })
  })

  test('retains setup failures for an injected adapter with an unregistered version', async () => {
    const scenario = developmentScenario('direct-fact')
    const result = await executeScenarioJob(
      {
        candidateId: 'corrected-hybrid',
        scenario,
        scale: 1000,
        seed: 20260723,
        queryTimeoutMs: 1000,
      },
      {
        createCandidate: () =>
          fakeCandidate(emptySuccess, {
            candidateId: 'corrected-hybrid',
            version: 'unregistered-version',
          }),
      },
    )

    expect(result.candidateId).toBe('corrected-hybrid')
    expect(result.candidateVersion).toBe(candidateVersions['corrected-hybrid'])
    expect(result.failures[0]).toMatchObject({
      stage: 'setup',
      kind: 'validation',
    })
  })

  test('logs restart, rebuild, version change, and exact pre/post agreement before the scored query', async () => {
    const scenario = developmentScenario('restart-rebuild')
    const result = await executeScenarioJob(
      {
        candidateId: 'corrected-hybrid',
        scenario,
        scale: 1000,
        seed: 20260723,
        queryTimeoutMs: 1000,
      },
      { createCandidate: createCorrectedHybridCandidate },
    )
    const kinds = result.lifecycle.map(({ kind }) => kind)

    expect(kinds.indexOf('embedding-version-change')).toBeLessThan(kinds.indexOf('restart'))
    expect(kinds.indexOf('restart')).toBeLessThan(kinds.indexOf('rebuild'))
    expect(kinds.indexOf('rebuild')).toBeLessThan(kinds.indexOf('query'))
    expect(result.rebuildProbes).toHaveLength(1)
    expect(result.rebuildProbes[0]).toMatchObject({ status: 'success' })
    expect(result.scenario.queries).toHaveLength(1)
  })

  test('retains cumulative and peak resources across restart and rebuild adapter replacements', async () => {
    const rebuildScenario = developmentScenario('restart-rebuild')
    const restartScenario: MemoryScenario = {
      ...rebuildScenario,
      faults: { ...rebuildScenario.faults, rebuildBeforeQueryIds: [] },
    }
    const firstResources: ResourceMetrics = {
      ingestedEventCount: 1000,
      ingestDurationMs: 10,
      ingestThroughputPerSecond: 100_000,
      retrievalCount: 2,
      modelCallCount: 3,
      extractorCallCount: 5,
      storedBytes: 4000,
      incrementalRssBytes: 9000,
    }
    const secondResources: ResourceMetrics = {
      ingestedEventCount: 100,
      ingestDurationMs: 30,
      ingestThroughputPerSecond: 10_000 / 3,
      retrievalCount: 7,
      modelCallCount: 11,
      extractorCallCount: 13,
      storedBytes: 8000,
      incrementalRssBytes: 6000,
    }

    for (const scenario of [restartScenario, rebuildScenario]) {
      const calls: string[] = []
      const candidates = [
        candidateWithResources('first', calls, () => Promise.resolve(firstResources)),
        candidateWithResources('second', calls, () => Promise.resolve(secondResources)),
      ]
      let candidateIndex = 0
      const result = await executeScenarioJob(
        {
          candidateId: 'corrected-hybrid',
          scenario,
          scale: 1000,
          seed: 20260723,
          queryTimeoutMs: 1000,
        },
        { createCandidate: () => candidates[candidateIndex++]! },
      )

      expect(result.resources).toEqual({
        ingestedEventCount: 1100,
        ingestDurationMs: 40,
        ingestThroughputPerSecond: 27_500,
        retrievalCount: 9,
        modelCallCount: 14,
        extractorCallCount: 18,
        storedBytes: 8000,
        incrementalRssBytes: 9000,
      })
      expect(calls.indexOf('first:resources')).toBeLessThan(calls.indexOf('first:reset:2'))
      expect(candidateIndex).toBe(2)
    }
  })

  test('retains a timed-out retirement snapshot as a resource failure and continues with the replacement', async () => {
    const scenario = developmentScenario('restart-rebuild')
    const currentResources: ResourceMetrics = {
      ingestedEventCount: 50,
      ingestDurationMs: 5,
      ingestThroughputPerSecond: 10_000,
      retrievalCount: 1,
      modelCallCount: 0,
      extractorCallCount: 0,
      storedBytes: 500,
      incrementalRssBytes: 600,
    }
    const candidates = [
      candidateWithResources(
        'retiring',
        [],
        () =>
          new Promise(() => {
            // The runner deadline must settle this deliberately pending snapshot.
          }),
      ),
      candidateWithResources('current', [], () => Promise.resolve(currentResources)),
    ]
    let candidateIndex = 0
    const result = await executeScenarioJob(
      {
        candidateId: 'corrected-hybrid',
        scenario,
        scale: 1000,
        seed: 20260723,
        queryTimeoutMs: 5,
      },
      { createCandidate: () => candidates[candidateIndex++]! },
    )

    expect(result.failures).toContainEqual({
      scenarioId: scenario.scenarioId,
      queryId: scenario.queries[0]!.queryId,
      stage: 'resource',
      kind: 'timeout',
      message: 'Resource metrics timed out',
    })
    expect(result.scenario.queries).toHaveLength(scenario.queries.length)
    expect(result.resources).toEqual(currentResources)
  })

  test('applies forget before attempted recapture and never drops the scored query', async () => {
    const scenario = developmentScenario('erasure-non-recapture')
    const result = await executeScenarioJob(
      {
        candidateId: 'corrected-hybrid',
        scenario,
        scale: 1000,
        seed: 20260723,
        queryTimeoutMs: 1000,
      },
      { createCandidate: createCorrectedHybridCandidate },
    )
    const kinds = result.lifecycle.map(({ kind }) => kind)

    expect(kinds.indexOf('forget')).toBeLessThan(kinds.indexOf('recapture-attempt'))
    expect(kinds.indexOf('recapture-attempt')).toBeLessThan(kinds.indexOf('query'))
    expect(result.scenario.queries[0]!.metrics.erasedHitCount).toBe(0)
  })

  test('converts exceptions and deadlines to retained failure or timeout rows', async () => {
    const scenario = developmentScenario('cross-scope')
    const exception = await executeScenarioJob(
      {
        candidateId: 'corrected-hybrid',
        scenario,
        scale: 1000,
        seed: 20260723,
        queryTimeoutMs: 20,
      },
      {
        createCandidate: () =>
          fakeCandidate((query): Promise<RawQueryResult> => Promise.reject(new Error(`failed ${query.queryId}`))),
      },
    )
    const timeout = await executeScenarioJob(
      {
        candidateId: 'corrected-hybrid',
        scenario,
        scale: 1000,
        seed: 20260723,
        queryTimeoutMs: 5,
      },
      { createCandidate: () => fakeCandidate(neverCompletes) },
    )

    expect(exception.scenario.queries[0]!.rawResult.status).toBe('failure')
    expect(exception.failures[0]).toMatchObject({ kind: 'exception', stage: 'retrieve' })
    expect(timeout.scenario.queries[0]!.rawResult.status).toBe('timeout')
    expect(timeout.failures[0]).toMatchObject({ kind: 'timeout', stage: 'retrieve' })
  })

  test('retains every query in the denominator when setup or ingest throws', async () => {
    const scenario = developmentScenario('direct-fact')
    const base = fakeCandidate(emptySuccess)
    const result = await executeScenarioJob(
      {
        candidateId: 'corrected-hybrid',
        scenario,
        scale: 1000,
        seed: 20260723,
        queryTimeoutMs: 20,
      },
      {
        createCandidate: () => ({
          ...base,
          ingest: (): Promise<IngestResult> => Promise.reject(new Error('synthetic ingest failure')),
        }),
      },
    )

    expect(result.scenario.queries).toHaveLength(scenario.queries.length)
    expect(result.scenario.queries[0]!.rawResult.status).toBe('failure')
    expect(result.failures[0]).toMatchObject({ kind: 'exception', stage: 'ingest' })
  })

  test('retains invalid raw candidate output as a validation failure in the report denominator', async () => {
    const scenario = developmentScenario('direct-fact')
    const mismatchedQueryId = developmentScenario('cross-scope').queries[0]!.queryId
    const result = await executeScenarioJob(
      {
        candidateId: 'corrected-hybrid',
        scenario,
        scale: 1000,
        seed: 20260723,
        queryTimeoutMs: 1000,
      },
      {
        createCandidate: () =>
          fakeCandidate(() =>
            Promise.resolve({
              status: 'success',
              queryId: mismatchedQueryId,
              hits: [],
              latencyMs: 1,
            }),
          ),
      },
    )

    expect(result.scenario.queries).toHaveLength(scenario.queries.length)
    expect(result.scenario.queries[0]!.rawResult.status).toBe('failure')
    expect(result.failures[0]).toMatchObject({
      queryId: scenario.queries[0]!.queryId,
      stage: 'retrieve',
      kind: 'validation',
    })
  })

  test.each(invalidHitCases)('rejects candidate output with %s', async (_label, createHits) => {
    const query = developmentScenario('direct-fact').queries[0]!
    const result = await retrieveWithDeadline(
      fakeCandidate(() =>
        Promise.resolve({
          status: 'success',
          queryId: query.queryId,
          hits: createHits(query),
          latencyMs: 1,
        }),
      ),
      query,
      1000,
      () => 1,
    )

    expect(result.rawResult.status).toBe('failure')
    expect(result.failure).toMatchObject({
      queryId: query.queryId,
      stage: 'retrieve',
      kind: 'validation',
    })
  })

  test('retains a validation failure when hostile raw-result property access throws', async () => {
    const query = developmentScenario('direct-fact').queries[0]!
    const poisoned: RawQueryResult = {
      status: 'success',
      queryId: query.queryId,
      hits: [],
      latencyMs: 1,
    }
    Object.defineProperty(poisoned, 'status', {
      get: (): never => {
        throw new Error('poisoned status getter')
      },
    })

    const result = await retrieveWithDeadline(
      fakeCandidate(() => Promise.resolve(poisoned)),
      query,
      1000,
      () => 1,
    )

    expect(result.rawResult.status).toBe('failure')
    expect(result.failure).toMatchObject({ stage: 'retrieve', kind: 'validation' })
  })

  test('uses harness-observed retrieval latency for every validated candidate status', async () => {
    const query = developmentScenario('direct-fact').queries[0]!
    const candidateResults: readonly RawQueryResult[] = [
      {
        status: 'success',
        queryId: query.queryId,
        hits: [],
        latencyMs: 99_999,
      },
      {
        status: 'failure',
        queryId: query.queryId,
        latencyMs: 99_999,
        error: 'candidate-reported failure',
      },
      {
        status: 'timeout',
        queryId: query.queryId,
        latencyMs: 99_999,
        timeoutMs: 99_999,
      },
    ]
    const observed = await Promise.all(
      candidateResults.map(async (candidateResult) => {
        const ticks = [100, 107]
        let tick = 0
        const result = await retrieveWithDeadline(
          fakeCandidate(() => Promise.resolve(candidateResult)),
          query,
          1000,
          () => ticks[tick++]!,
        )
        return result.rawResult.latencyMs
      }),
    )

    expect(observed).toEqual([7, 7, 7])
  })
})

describe('worker scheduling', () => {
  test('executes asynchronous jobs strictly one at a time and preserves input order', async () => {
    let active = 0
    let maximumActive = 0
    const outputs = await runSequentially([3, 1, 2], async (value): Promise<number> => {
      active += 1
      maximumActive = Math.max(maximumActive, active)
      await Bun.sleep(value)
      active -= 1
      return value * 10
    })

    expect(outputs).toEqual([30, 10, 20])
    expect(maximumActive).toBe(1)
  })

  test('uses a fresh child process and converts a hard worker deadline to timeout rows', async () => {
    const scenario = developmentScenario('direct-fact')
    const input = {
      candidateId: 'corrected-hybrid',
      scenario,
      scale: 1000,
      seed: 20260723,
      queryTimeoutMs: 1000,
    } as const
    const isolated = await runIsolatedScenarioJob(input, { deadlineMs: 10_000 })
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'papai-memory-worker-'))
    const slowWorker = join(temporaryRoot, 'slow-worker.ts')
    await Bun.write(slowWorker, 'await Bun.sleep(10_000)\n')
    const timeout = await runIsolatedScenarioJob(input, {
      workerPath: slowWorker,
      deadlineMs: 20,
    })

    expect(isolated.workerPid).not.toBe(process.pid)
    expect(isolated.scenario.scenarioId).toBe(scenario.scenarioId)
    expect(timeout.scenario.queries[0]!.rawResult.status).toBe('timeout')
    expect(timeout.failures[0]).toMatchObject({ kind: 'timeout', stage: 'setup' })
  }, 15_000)

  test('escalates an ignored SIGTERM to SIGKILL and settles within a bounded grace period', async () => {
    const scenario = developmentScenario('direct-fact')
    const input = {
      candidateId: 'corrected-hybrid',
      scenario,
      scale: 1000,
      seed: 20260723,
      queryTimeoutMs: 1000,
    } as const
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'papai-memory-stubborn-worker-'))
    const stubbornWorker = join(temporaryRoot, 'stubborn-worker.ts')
    await Bun.write(stubbornWorker, "process.on('SIGTERM', () => undefined)\nawait Bun.sleep(1_000)\n")
    const startedAt = performance.now()
    const result = await runIsolatedScenarioJob(input, {
      workerPath: stubbornWorker,
      deadlineMs: 200,
      terminationGraceMs: 20,
    })
    const elapsedMs = performance.now() - startedAt

    expect(elapsedMs).toBeLessThan(700)
    expect(result.candidateId).toBe('corrected-hybrid')
    expect(result.candidateVersion).toBe(candidateVersions['corrected-hybrid'])
    expect(result.scenario.queries[0]!.rawResult.status).toBe('timeout')
  })

  test('converts a spoofed worker candidate identity to retained setup failures', async () => {
    const scenario = developmentScenario('direct-fact')
    const input = {
      candidateId: 'corrected-hybrid',
      scenario,
      scale: 1000,
      seed: 20260723,
      queryTimeoutMs: 1000,
    } as const
    const valid = await executeScenarioJob(input)
    const spoofed = {
      ...valid,
      candidateId: 'as-shipped',
      candidateVersion: candidateVersions['as-shipped'],
    } as const
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'papai-memory-spoofed-worker-'))
    const spoofedWorker = join(temporaryRoot, 'spoofed-worker.ts')
    await Bun.write(spoofedWorker, `process.stdout.write(${JSON.stringify(`${JSON.stringify(spoofed)}\n`)})\n`)
    const result = await runIsolatedScenarioJob(input, {
      workerPath: spoofedWorker,
      deadlineMs: 1000,
    })

    expect(result.candidateId).toBe('corrected-hybrid')
    expect(result.candidateVersion).toBe(candidateVersions['corrected-hybrid'])
    expect(result.scenario.queries).toHaveLength(scenario.queries.length)
    expect(result.failures[0]).toMatchObject({
      stage: 'setup',
      kind: 'validation',
    })
  })

  test('rejects an injected parent job result with a mismatched registered candidate version', async () => {
    const scenario = developmentScenario('direct-fact')
    const experiment = runResearchExperiment(
      {
        split: 'development',
        candidateIds: ['corrected-hybrid'],
        scale: 1000,
        seed: 20260723,
        workspaceRoot: process.cwd(),
        queryTimeoutMs: 1000,
        workerDeadlineMs: 10_000,
        scenarioIds: [scenario.scenarioId],
      },
      {
        sourcePaths: ['scripts/memory-research/types.ts'],
        runtimeMetadata: {
          repository: {
            revision: 'eab9ed2b4e2dac0279d338436b59c3a89d87bc8a',
            dirty: true,
          },
          runtime: { bunVersion: Bun.version, os: process.platform, arch: process.arch },
          hardware: { cpuModel: 'test-cpu', cpuCount: 8, totalMemoryBytes: 16_000_000_000 },
        },
        now: (): Date => new Date(Date.UTC(2026, 6, 23, 10)),
        executeJob: async (jobInput) => ({
          ...(await executeScenarioJob(jobInput)),
          candidateVersion: 'spoofed-version',
        }),
      },
    )

    await expect(experiment).rejects.toThrow('candidate version')
  })

  test('records the supplied local path for a validated public dataset', async () => {
    const scenario = developmentScenario('direct-fact')
    const report = await runResearchExperiment(
      {
        split: 'development',
        candidateIds: ['corrected-hybrid'],
        scale: 1000,
        seed: 20260723,
        workspaceRoot: process.cwd(),
        queryTimeoutMs: 1000,
        workerDeadlineMs: 10_000,
        scenarioIds: [scenario.scenarioId],
        publicDatasets: [validatedLongMemEval],
        publicDatasetLocalPaths: { longmemeval: '/local/benchmarks/longmemeval.json' },
      },
      {
        sourcePaths: ['scripts/memory-research/types.ts'],
        runtimeMetadata: {
          repository: {
            revision: 'eab9ed2b4e2dac0279d338436b59c3a89d87bc8a',
            dirty: true,
          },
          runtime: { bunVersion: Bun.version, os: process.platform, arch: process.arch },
          hardware: { cpuModel: 'test-cpu', cpuCount: 8, totalMemoryBytes: 16_000_000_000 },
        },
        now: (): Date => new Date(Date.UTC(2026, 6, 23, 10)),
        executeJob: executeScenarioJob,
      },
    )
    const publicStatus = report.publicDatasets.find(({ datasetId }) => datasetId === 'longmemeval')

    expect(publicStatus).toMatchObject({
      importStatus: 'validated',
      localPath: '/local/benchmarks/longmemeval.json',
      protocolStatus: 'not_run',
    })
  })

  test('requires successful worker execution before passing self-hosting', async () => {
    const scenario = developmentScenario('direct-fact')
    const report = await runResearchExperiment(
      {
        split: 'development',
        candidateIds: ['corrected-hybrid'],
        scale: 1000,
        seed: 20260723,
        workspaceRoot: process.cwd(),
        queryTimeoutMs: 1000,
        workerDeadlineMs: 10_000,
        scenarioIds: [scenario.scenarioId],
      },
      {
        sourcePaths: ['scripts/memory-research/types.ts'],
        runtimeMetadata: {
          repository: {
            revision: 'eab9ed2b4e2dac0279d338436b59c3a89d87bc8a',
            dirty: true,
          },
          runtime: { bunVersion: Bun.version, os: process.platform, arch: process.arch },
          hardware: { cpuModel: 'test-cpu', cpuCount: 8, totalMemoryBytes: 16_000_000_000 },
        },
        now: (): Date => new Date(Date.UTC(2026, 6, 23, 10)),
        executeJob: (input) =>
          executeScenarioJob(input, {
            createCandidate: () =>
              fakeCandidate((query): Promise<RawQueryResult> => Promise.reject(new Error(`failed ${query.queryId}`))),
          }),
      },
    )
    const candidate = report.candidates[0]!

    expect(candidate.workers[0]!.status).toBe('failure')
    expect(candidate.gates.selfHosting.state).toBe('not_evaluable')
    expect(candidate.gates.reproducibility.state).toBe('pass')
  })

  test('builds one validated comparison report while scheduling candidate jobs serially', async () => {
    const scenarios = [developmentScenario('direct-fact'), developmentScenario('cross-scope')]
    let active = 0
    let maximumActive = 0
    const calls: string[] = []
    let clockTick = 0
    const report = await runResearchExperiment(
      {
        split: 'development',
        candidateIds: ['corrected-hybrid', 'as-shipped'],
        scale: 1000,
        seed: 20260723,
        workspaceRoot: process.cwd(),
        queryTimeoutMs: 1000,
        workerDeadlineMs: 10_000,
        scenarioIds: scenarios.map(({ scenarioId }) => scenarioId),
      },
      {
        sourcePaths: ['scripts/memory-research/types.ts'],
        runtimeMetadata: {
          repository: {
            revision: 'eab9ed2b4e2dac0279d338436b59c3a89d87bc8a',
            dirty: true,
          },
          runtime: { bunVersion: Bun.version, os: process.platform, arch: process.arch },
          hardware: { cpuModel: 'test-cpu', cpuCount: 8, totalMemoryBytes: 16_000_000_000 },
        },
        now: (): Date => new Date(Date.UTC(2026, 6, 23, 10, clockTick++)),
        executeJob: async (input) => {
          active += 1
          maximumActive = Math.max(maximumActive, active)
          calls.push(`${input.candidateId}/${input.scenario.scenarioId}`)
          const result = await executeScenarioJob(input)
          active -= 1
          return result
        },
      },
    )

    expect(maximumActive).toBe(1)
    expect(calls).toEqual([
      `corrected-hybrid/${scenarios[0]!.scenarioId}`,
      `corrected-hybrid/${scenarios[1]!.scenarioId}`,
      `as-shipped/${scenarios[0]!.scenarioId}`,
      `as-shipped/${scenarios[1]!.scenarioId}`,
    ])
    expect(report.candidates.map(({ registration }) => registration.id)).toEqual(['as-shipped', 'corrected-hybrid'])
    expect(
      report.candidates.map(({ manifest }) => [
        manifest.candidate.config['queryTimeoutMs'],
        manifest.candidate.config['workerDeadlineMs'],
      ]),
    ).toEqual([
      [1000, 10_000],
      [1000, 10_000],
    ])
    expect(report.candidates.map(({ workers }) => workers.length)).toEqual([scenarios.length, scenarios.length])
    expect(report.candidates.map(({ resourcesComplete }) => resourcesComplete)).toEqual([true, true])
    expect(report.candidates.map(({ resources }) => resources)).toEqual(
      report.candidates.map(({ workers }) => aggregateWorkerResources(workers)),
    )
    expect(report.publicDatasets.every(({ protocolStatus }) => protocolStatus === 'not_run')).toBeTrue()
  }, 15_000)
})
