// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { candidateVersions } from '../../scripts/memory-research/candidate-registry.js'
import { memoryScenarios } from '../../scripts/memory-research/corpus.js'
import { FROZEN_SCENARIO_MANIFEST } from '../../scripts/memory-research/manifest.js'
import {
  evaluateStorageDecision,
  FROZEN_100K_MEASURED_RETRIEVALS,
  FROZEN_100K_SCENARIO_IDS,
  FROZEN_100K_SEED,
  FROZEN_100K_STORED_RECORDS,
  FROZEN_100K_WARMUPS,
} from '../../scripts/memory-research/statistics-storage.js'
import type { StorageJobInput } from '../../scripts/memory-research/storage-contracts.js'
import { runFrozen100kStorageExperiment } from '../../scripts/memory-research/storage-experiment.js'
import { runIsolatedFrozen100kStorageJob } from '../../scripts/memory-research/storage-isolation.js'
import {
  executeFrozen100kStorageJob,
  normalizeBunMaximumRssBytes,
} from '../../scripts/memory-research/storage-runner.js'
import { MemoryHitSchema } from '../../scripts/memory-research/types.js'
import type {
  AssembledContext,
  ForgetResult,
  IngestResult,
  MemoryCandidateAdapter,
  MemoryEvent,
  MemoryHit,
  OperationalMemoryQuery,
  RawQueryResult,
  ResourceMetrics,
} from '../../scripts/memory-research/types.js'

const scenario = memoryScenarios.find(({ scenarioId }) => scenarioId === FROZEN_100K_SCENARIO_IDS[0])!

const storageInput = (selectedScenario: StorageJobInput['scenario'] = scenario): StorageJobInput => ({
  candidateId: 'temporal-graph',
  scenario: selectedScenario,
  scenarioManifestVersion: FROZEN_SCENARIO_MANIFEST.scenarioManifestVersion,
  scenarioManifestSha256: FROZEN_SCENARIO_MANIFEST.scenarioManifestSha256,
  seed: FROZEN_100K_SEED,
  queryTimeoutMs: 1000,
})

const scenarioWithModifiedQuery = (): typeof scenario => {
  const firstQuery = scenario.queries[0]
  if (firstQuery === undefined) throw new Error('Frozen storage test scenario has no query')
  return {
    ...scenario,
    queries: [{ ...firstQuery, text: `${firstQuery.text} modified` }, ...scenario.queries.slice(1)],
  }
}

const expectedHit = ((): MemoryHit => {
  const evidenceId = scenario.queries[0]!.expectedEvidenceIds[0]!
  const event = scenario.events.find((candidate) => candidate.evidenceId === evidenceId)!
  return MemoryHitSchema.parse({
    evidenceId: event.evidenceId,
    sourceEventId: event.eventId,
    scope: event.scope,
    score: { lexical: 0, dense: 0, graph: 1, recency: 0, total: 1 },
    rank: 1,
    content: event.content,
    validity: event.validity,
    provenance: { kind: 'canonical', derivedFromEvidenceIds: [] },
  })
})()

const storageCandidate = (onRetrieve: () => void): MemoryCandidateAdapter => ({
  candidateId: 'temporal-graph',
  version: 'storage-fake-v1',
  reset: (): Promise<void> => Promise.resolve(),
  ingest: (events: readonly MemoryEvent[]): Promise<IngestResult> =>
    Promise.resolve({ ingestedEventCount: events.length, durationMs: 1 }),
  retrieve: (query: OperationalMemoryQuery): Promise<RawQueryResult> => {
    onRetrieve()
    return Promise.resolve({
      status: 'success',
      queryId: query.queryId,
      hits: [expectedHit],
      latencyMs: 2,
    })
  },
  assembleContext: (): Promise<AssembledContext> => Promise.resolve({ text: '', tokenCount: 0, evidenceIds: [] }),
  forget: (request): Promise<ForgetResult> =>
    Promise.resolve({ erasedEvidenceIds: [], completedAt: request.completedAt }),
  rebuild: (): Promise<void> => Promise.resolve(),
  resourceMetrics: (): Promise<ResourceMetrics> =>
    Promise.resolve({
      ingestedEventCount: FROZEN_100K_STORED_RECORDS,
      ingestDurationMs: 100,
      ingestThroughputPerSecond: 1_000_000,
      retrievalCount: FROZEN_100K_WARMUPS + FROZEN_100K_MEASURED_RETRIEVALS,
      modelCallCount: 0,
      extractorCallCount: 0,
      storedBytes: 1_000_000,
      incrementalRssBytes: 2_000_000,
    }),
})

describe('frozen 100k storage runner', () => {
  test('treats Bun resourceUsage maxRSS as bytes on the frozen runtime', () => {
    expect(normalizeBunMaximumRssBytes(22_495_232)).toBe(22_495_232)
  })

  test('uses the exact scenario, row count, warmup, samples, and pre-serialization RSS contract', async () => {
    let retrievals = 0
    const result = await executeFrozen100kStorageJob(storageInput(), {
      createCandidate: () =>
        storageCandidate(() => {
          retrievals += 1
        }),
    })

    expect(retrievals).toBe(FROZEN_100K_WARMUPS + FROZEN_100K_MEASURED_RETRIEVALS)
    expect(result.run).toMatchObject({
      scenarioId: scenario.scenarioId,
      status: 'success',
      fixturesMaterializedBeforeReset: true,
      primaryScopeStoredRecordCount: FROZEN_100K_STORED_RECORDS,
      recordsOutsidePrimaryScope: 0,
      warmupCount: FROZEN_100K_WARMUPS,
      rssCapture: 'current-pre-serialization',
      incrementalRssBytes: 2_000_000,
    })
    expect(result.run.absoluteProcessPeakRssBytes).toBeGreaterThan(0)
    expect(result.run.measuredLatenciesMs).toHaveLength(FROZEN_100K_MEASURED_RETRIEVALS)
    expect(result).toMatchObject({
      scenarioManifestVersion: FROZEN_SCENARIO_MANIFEST.scenarioManifestVersion,
      scenarioManifestSha256: FROZEN_SCENARIO_MANIFEST.scenarioManifestSha256,
    })
  })

  test('rejects workload metadata that claims 100k without 100k unique primary-scope rows', async () => {
    await expect(
      executeFrozen100kStorageJob(storageInput(), {
        createCandidate: () => storageCandidate(() => undefined),
        materializeWorkload: () => ({
          scaleEvents: [],
          recordedEvents: scenario.events,
          canonicalEvents: scenario.events,
          scopeRecordCounts: [
            {
              scope: scenario.primaryScope,
              count: FROZEN_100K_STORED_RECORDS,
            },
          ],
        }),
      }),
    ).rejects.toThrow('100000 unique')
  })

  test('records harness-observed retrieval latency instead of candidate-reported latency', async () => {
    let clock = 0
    const result = await executeFrozen100kStorageJob(storageInput(), {
      createCandidate: () => storageCandidate(() => undefined),
      monotonicNow: () => {
        const current = clock
        clock += 300
        return current
      },
    })

    expect(result.run.measuredLatenciesMs).toEqual(Array.from({ length: FROZEN_100K_MEASURED_RETRIEVALS }, () => 300))
  })

  test('rejects any scenario outside the four-cell frozen selection', async () => {
    const wrongScenario = memoryScenarios.find(
      ({ scenarioId }) => !FROZEN_100K_SCENARIO_IDS.some((frozenId) => frozenId === scenarioId),
    )!

    await expect(executeFrozen100kStorageJob(storageInput(wrongScenario))).rejects.toThrow('frozen 100k')
  })

  test('rejects modified scenario content even when the frozen scenario id is retained', async () => {
    await expect(executeFrozen100kStorageJob(storageInput(scenarioWithModifiedQuery()))).rejects.toThrow('identity')
  })

  test('runs every candidate/cell serially and feeds the frozen storage decision', async () => {
    let active = 0
    let maximumActive = 0
    const calls: string[] = []
    const experiments = await runFrozen100kStorageExperiment(
      {
        candidateIds: ['corrected-hybrid', 'temporal-graph'],
        workspaceRoot: process.cwd(),
        seed: FROZEN_100K_SEED,
        queryTimeoutMs: 1000,
        workerDeadlineMs: 10_000,
      },
      {
        executeJob: async (input) => {
          active += 1
          maximumActive = Math.max(maximumActive, active)
          calls.push(`${input.candidateId}/${input.scenario.scenarioId}`)
          await Bun.sleep(1)
          active -= 1
          return {
            candidateId: input.candidateId,
            candidateVersion: candidateVersions[input.candidateId],
            workerPid: process.pid + 1,
            scenarioManifestVersion: FROZEN_SCENARIO_MANIFEST.scenarioManifestVersion,
            scenarioManifestSha256: FROZEN_SCENARIO_MANIFEST.scenarioManifestSha256,
            run: {
              scenarioId: input.scenario.scenarioId,
              status: 'success',
              freshWorker: true,
              fixturesMaterializedBeforeReset: true,
              primaryScopeStoredRecordCount: FROZEN_100K_STORED_RECORDS,
              recordsOutsidePrimaryScope: 0,
              warmupCount: FROZEN_100K_WARMUPS,
              measuredLatenciesMs: Array.from({ length: FROZEN_100K_MEASURED_RETRIEVALS }, () => 2),
              incrementalRssBytes: 2_000_000,
              absoluteProcessPeakRssBytes: 3_000_000,
              rssCapture: 'current-pre-serialization',
            },
            resources: {
              ingestedEventCount: FROZEN_100K_STORED_RECORDS,
              ingestDurationMs: 100,
              ingestThroughputPerSecond: 1_000_000,
              retrievalCount: FROZEN_100K_WARMUPS + FROZEN_100K_MEASURED_RETRIEVALS,
              modelCallCount: 0,
              extractorCallCount: 0,
              storedBytes: 1_000_000,
              incrementalRssBytes: 2_000_000,
            },
            failure: null,
          }
        },
      },
    )

    expect(maximumActive).toBe(1)
    expect(calls).toHaveLength(8)
    expect(evaluateStorageDecision(experiments[0]!.jobs.map(({ run }) => run))).toMatchObject({
      status: 'decided',
      decision: 'keep-sqlite',
    })
  })

  test('turns a hard isolated-worker deadline into a blocking failed storage run', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'papai-storage-worker-'))
    const slowWorker = join(temporaryRoot, 'slow-storage-worker.ts')
    await Bun.write(slowWorker, 'await Bun.sleep(10_000)\n')
    const result = await runIsolatedFrozen100kStorageJob(storageInput(), { workerPath: slowWorker, deadlineMs: 20 })

    expect(result.run).toMatchObject({
      status: 'failure',
      freshWorker: true,
      fixturesMaterializedBeforeReset: false,
    })
    expect(evaluateStorageDecision([result.run])).toMatchObject({
      status: 'blocked',
    })
  })

  test('escalates to SIGKILL when a storage worker ignores SIGTERM', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'papai-storage-worker-'))
    const slowWorker = join(temporaryRoot, 'ignore-term-storage-worker.ts')
    await Bun.write(slowWorker, "process.on('SIGTERM', () => undefined)\nawait Bun.sleep(10_000)\n")
    const startedAt = performance.now()
    const result = await runIsolatedFrozen100kStorageJob(storageInput(), {
      workerPath: slowWorker,
      deadlineMs: 20,
      terminationGraceMs: 20,
    })

    expect(performance.now() - startedAt).toBeLessThan(1000)
    expect(result.run.status).toBe('failure')
    expect(result.failure).toContain('exceeded')
  })
})
