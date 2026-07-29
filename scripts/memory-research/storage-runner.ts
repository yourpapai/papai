// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createMemoryCandidate } from './candidate-registry.js'
import { memoryScenarios } from './corpus.js'
import { canonicalSerialize, FROZEN_SCENARIO_MANIFEST } from './manifest.js'
import { retrieveWithDeadline } from './runner-query.js'
import { runSequentially } from './runner-sequential.js'
import { materializeScenarioWorkload } from './runner-workload.js'
import type { ScenarioWorkload } from './runner-workload.js'
import {
  FROZEN_100K_MEASURED_RETRIEVALS,
  FROZEN_100K_SCENARIO_IDS,
  FROZEN_100K_STORED_RECORDS,
  FROZEN_100K_WARMUPS,
} from './statistics-storage.js'
import { StorageJobInputSchema } from './storage-contracts.js'
import type { StorageJobDependencies, StorageJobInput, StorageJobResult } from './storage-contracts.js'
import type {
  MemoryCandidateAdapter,
  MemoryEvent,
  MemoryQuery,
  MemoryScope,
  RawQueryResult,
  ResourceMetrics,
} from './types.js'

const sameScope = (left: MemoryScope, right: MemoryScope): boolean => left.kind === right.kind && left.id === right.id

const frozenScenario = (scenarioId: string): StorageJobInput['scenario'] | undefined =>
  memoryScenarios.find(
    (candidate) =>
      candidate.scenarioId === scenarioId &&
      FROZEN_100K_SCENARIO_IDS.some((frozenId) => frozenId === candidate.scenarioId),
  )

const assertFrozenScenarioIdentity = (scenario: StorageJobInput['scenario']): void => {
  const expected = frozenScenario(scenario.scenarioId)
  if (expected === undefined) {
    throw new Error(`Scenario is outside the frozen 100k selection: ${scenario.scenarioId}`)
  }
  if (canonicalSerialize(scenario) !== canonicalSerialize(expected)) {
    throw new Error(`Frozen 100k scenario identity mismatch: ${scenario.scenarioId}`)
  }
}

const successfulCorrectRetrieval = (query: MemoryQuery, result: RawQueryResult): boolean => {
  if (result.status !== 'success') return false
  const hitIds = new Set(result.hits.map(({ evidenceId }) => evidenceId))
  return (
    query.expectedEvidenceIds.every((evidenceId) => hitIds.has(evidenceId)) &&
    query.forbiddenEvidenceIds.every((evidenceId) => !hitIds.has(evidenceId)) &&
    query.erasedEvidenceIds.every((evidenceId) => !hitIds.has(evidenceId))
  )
}

const fallbackResources = (): ResourceMetrics => ({
  ingestedEventCount: 0,
  ingestDurationMs: 0,
  ingestThroughputPerSecond: 0,
  retrievalCount: 0,
  modelCallCount: 0,
  extractorCallCount: 0,
  storedBytes: 0,
  incrementalRssBytes: 0,
})

const uniqueEventCount = (events: readonly MemoryEvent[], field: 'eventId' | 'evidenceId'): number =>
  new Set(events.map((event) => event[field])).size

const validateFrozenWorkload = (
  input: StorageJobInput,
  workload: ScenarioWorkload,
): Readonly<{ primary: number; outside: number }> => {
  if (canonicalSerialize(workload.canonicalEvents) !== canonicalSerialize(input.scenario.events)) {
    throw new Error('Frozen 100k workload canonical events do not match the scenario')
  }
  const storedRows = [...workload.scaleEvents, ...workload.canonicalEvents]
  const primary = storedRows.filter(({ scope }) => sameScope(scope, input.scenario.primaryScope)).length
  const outside = storedRows.length - primary
  const metadataPrimary = workload.scopeRecordCounts
    .filter(({ scope }) => sameScope(scope, input.scenario.primaryScope))
    .reduce((sum, { count }) => sum + count, 0)
  const metadataOutside = workload.scopeRecordCounts
    .filter(({ scope }) => !sameScope(scope, input.scenario.primaryScope))
    .reduce((sum, { count }) => sum + count, 0)
  if (
    storedRows.length !== FROZEN_100K_STORED_RECORDS ||
    uniqueEventCount(storedRows, 'eventId') !== FROZEN_100K_STORED_RECORDS ||
    uniqueEventCount(storedRows, 'evidenceId') !== FROZEN_100K_STORED_RECORDS ||
    primary !== FROZEN_100K_STORED_RECORDS ||
    outside !== 0 ||
    metadataPrimary !== primary ||
    metadataOutside !== outside
  ) {
    throw new Error(`Frozen storage workload must contain 100000 unique primary-scope rows and zero outside`)
  }
  return { primary, outside }
}

const measureRetrievals = async (
  adapter: MemoryCandidateAdapter,
  query: MemoryQuery,
  timeoutMs: number,
  now: () => number,
): Promise<
  Readonly<{
    warmup: Awaited<ReturnType<typeof retrieveWithDeadline>>
    measured: readonly Awaited<ReturnType<typeof retrieveWithDeadline>>[]
  }>
> => ({
  warmup: await retrieveWithDeadline(adapter, query, timeoutMs, now),
  measured: await runSequentially(
    Array.from({ length: FROZEN_100K_MEASURED_RETRIEVALS }, (_, index) => index),
    (): Promise<Awaited<ReturnType<typeof retrieveWithDeadline>>> =>
      retrieveWithDeadline(adapter, query, timeoutMs, now),
  ),
})

const readResources = async (
  adapter: MemoryCandidateAdapter,
): Promise<Readonly<{ resources: ResourceMetrics; failure: string | null }>> => {
  try {
    return { resources: await adapter.resourceMetrics(), failure: null }
  } catch (error) {
    return {
      resources: fallbackResources(),
      failure: error instanceof Error ? error.message : String(error),
    }
  }
}

const resourceFailure = (workload: ScenarioWorkload, resources: ResourceMetrics): string | null => {
  const expectedIngested = workload.scaleEvents.length + workload.recordedEvents.length
  if (resources.ingestedEventCount !== expectedIngested) {
    return `Candidate reported ${resources.ingestedEventCount} ingested events; expected ${expectedIngested}`
  }
  const expectedRetrievals = FROZEN_100K_WARMUPS + FROZEN_100K_MEASURED_RETRIEVALS
  if (resources.retrievalCount !== expectedRetrievals) {
    return `Candidate reported ${resources.retrievalCount} retrievals; expected ${expectedRetrievals}`
  }
  return null
}

export const normalizeBunMaximumRssBytes = (maxRssBytes: number): number =>
  Number.isFinite(maxRssBytes) ? Math.max(0, Math.round(maxRssBytes)) : 0

const absoluteProcessPeakRssBytes = (): number => normalizeBunMaximumRssBytes(process.resourceUsage().maxRSS)

const executeMeasurements = async (
  input: StorageJobInput,
  workload: ScenarioWorkload,
  adapter: MemoryCandidateAdapter,
  now: () => number,
): Promise<
  Readonly<{
    query: MemoryQuery
    retrievals: Awaited<ReturnType<typeof measureRetrievals>>
    resourceResult: Awaited<ReturnType<typeof readResources>>
  }>
> => {
  if (adapter.candidateId !== input.candidateId) {
    throw new Error(
      `Storage candidate identity mismatch: expected ${input.candidateId}, received ${adapter.candidateId}`,
    )
  }
  const query = input.scenario.queries[0]
  if (query === undefined) throw new Error('Frozen storage scenario has no query')
  await adapter.reset()
  await adapter.ingest(workload.scaleEvents)
  await adapter.ingest(workload.recordedEvents)
  return {
    query,
    retrievals: await measureRetrievals(adapter, query, input.queryTimeoutMs, now),
    resourceResult: await readResources(adapter),
  }
}

export const executeFrozen100kStorageJob = async (
  inputValue: StorageJobInput,
  dependencies: StorageJobDependencies = {},
): Promise<StorageJobResult> => {
  const input = StorageJobInputSchema.parse(inputValue)
  assertFrozenScenarioIdentity(input.scenario)
  const materialize =
    dependencies.materializeWorkload ??
    ((scenario: StorageJobInput['scenario']): ScenarioWorkload =>
      materializeScenarioWorkload(scenario, FROZEN_100K_STORED_RECORDS, input.seed))
  const workload = materialize(input.scenario)
  const counts = validateFrozenWorkload(input, workload)
  const createCandidate =
    dependencies.createCandidate ?? ((): MemoryCandidateAdapter => createMemoryCandidate(input.candidateId))
  const now = dependencies.monotonicNow ?? ((): number => performance.now())
  const adapter = createCandidate()
  const { query, retrievals, resourceResult } = await executeMeasurements(input, workload, adapter, now)
  const correct =
    successfulCorrectRetrieval(query, retrievals.warmup.rawResult) &&
    retrievals.measured.every(({ rawResult }) => successfulCorrectRetrieval(query, rawResult))
  const failure =
    resourceResult.failure ??
    resourceFailure(workload, resourceResult.resources) ??
    (correct ? null : 'Warmup or measured retrieval failed correctness/status validation')
  return {
    candidateId: input.candidateId,
    candidateVersion: adapter.version,
    workerPid: process.pid,
    scenarioManifestVersion: FROZEN_SCENARIO_MANIFEST.scenarioManifestVersion,
    scenarioManifestSha256: FROZEN_SCENARIO_MANIFEST.scenarioManifestSha256,
    run: {
      scenarioId: input.scenario.scenarioId,
      status: failure === null ? 'success' : 'failure',
      freshWorker: false,
      fixturesMaterializedBeforeReset: true,
      primaryScopeStoredRecordCount: counts.primary,
      recordsOutsidePrimaryScope: counts.outside,
      warmupCount: FROZEN_100K_WARMUPS,
      measuredLatenciesMs: retrievals.measured.map(({ rawResult }) => rawResult.latencyMs),
      incrementalRssBytes: resourceResult.resources.incrementalRssBytes,
      absoluteProcessPeakRssBytes: absoluteProcessPeakRssBytes(),
      rssCapture: 'current-pre-serialization',
    },
    resources: resourceResult.resources,
    failure,
  }
}
