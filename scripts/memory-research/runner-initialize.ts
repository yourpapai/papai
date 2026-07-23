// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { RebuildProbe, RunFailure } from './report.js'
import type { ScenarioJobInput, ScenarioJobResult } from './runner-contracts.js'
import { eventWithEmbeddingVersion, forgetCoversEvent, orderedForgetRequests } from './runner-faults.js'
import type { LifecycleRecorder } from './runner-lifecycle.js'
import { failedQueryEvaluation } from './runner-query.js'
import { runSequentially } from './runner-sequential.js'
import type { ScenarioWorkload } from './runner-workload.js'
import type { MemoryCandidateAdapter, MemoryEvent, ResourceMetrics } from './types.js'

export type MutableExecution = {
  adapter: MemoryCandidateAdapter
  readonly events: Map<string, MemoryEvent>
  readonly failures: RunFailure[]
  readonly probes: RebuildProbe[]
  readonly retiredResources: ResourceMetrics[]
}

type InitializationFailure = Readonly<{
  stage: 'setup' | 'ingest' | 'forget'
  message: string
}>

export const zeroResources = (): ResourceMetrics => ({
  ingestedEventCount: 0,
  ingestDurationMs: 0,
  ingestThroughputPerSecond: 0,
  retrievalCount: 0,
  modelCallCount: 0,
  extractorCallCount: 0,
  storedBytes: 0,
  incrementalRssBytes: 0,
})

const ingestInitialEvents = async (
  execution: MutableExecution,
  input: ScenarioJobInput,
  workload: ScenarioWorkload,
  lifecycle: LifecycleRecorder,
): Promise<void> => {
  workload.scopeRecordCounts.forEach(({ count, scope }) => {
    const first = workload.scaleEvents.find((event) => event.scope.kind === scope.kind && event.scope.id === scope.id)
    lifecycle.add(
      'scale-ingest',
      `${scope.kind}:${scope.id}:${count}`,
      first?.ingestTime ?? input.scenario.events[0]!.ingestTime,
    )
  })
  await execution.adapter.ingest(workload.scaleEvents)
  workload.recordedEvents.forEach((event) => {
    lifecycle.add('event-ingest', event.eventId, event.ingestTime)
  })
  await execution.adapter.ingest(workload.recordedEvents)
}

const applyVersionChanges = async (
  execution: MutableExecution,
  input: ScenarioJobInput,
  lifecycle: LifecycleRecorder,
): Promise<void> => {
  const byEvidence = new Map([...execution.events.values()].map((event) => [event.evidenceId, event] as const))
  const changes = [...input.scenario.faults.embeddingVersionChanges].sort((left, right) =>
    left.changedAt.localeCompare(right.changedAt),
  )
  await runSequentially(changes, async (change): Promise<void> => {
    const current = byEvidence.get(change.evidenceId)
    if (current === undefined) throw new Error(`Missing version-change evidence ${change.evidenceId}`)
    const changed = eventWithEmbeddingVersion(current, change.toVersion, change.changedAt)
    lifecycle.add('embedding-version-change', change.evidenceId, change.changedAt)
    await execution.adapter.ingest([changed])
    execution.events.set(changed.eventId, changed)
    byEvidence.set(changed.evidenceId, changed)
  })
}

const coveredRecaptures = (
  execution: MutableExecution,
  input: ScenarioJobInput,
  request: Parameters<typeof forgetCoversEvent>[0],
  recaptured: ReadonlySet<string>,
): readonly MemoryEvent[] =>
  input.scenario.faults.recaptureAfterForgetEvidenceIds
    .filter((evidenceId) => !recaptured.has(evidenceId))
    .map((evidenceId) => [...execution.events.values()].find((event) => event.evidenceId === evidenceId))
    .filter((event): event is MemoryEvent => event !== undefined && forgetCoversEvent(request, event))

const applyForgetsAndRecapture = async (
  execution: MutableExecution,
  input: ScenarioJobInput,
  lifecycle: LifecycleRecorder,
): Promise<void> => {
  const recaptured = new Set<string>()
  await runSequentially(orderedForgetRequests(input.scenario), async (request): Promise<void> => {
    lifecycle.add('forget', `${request.kind}:${request.scope.id}`, request.completedAt)
    await execution.adapter.forget(request)
    const covered = coveredRecaptures(execution, input, request, recaptured)
    await runSequentially(covered, async (event): Promise<void> => {
      lifecycle.add('recapture-attempt', event.evidenceId, request.completedAt)
      await execution.adapter.ingest([event])
      recaptured.add(event.evidenceId)
    })
  })
}

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const runInitialization = async (
  execution: MutableExecution,
  input: ScenarioJobInput,
  workload: ScenarioWorkload,
  lifecycle: LifecycleRecorder,
): Promise<InitializationFailure | null> => {
  try {
    await execution.adapter.reset()
  } catch (error) {
    return { stage: 'setup', message: errorMessage(error) }
  }
  try {
    await ingestInitialEvents(execution, input, workload, lifecycle)
    await applyVersionChanges(execution, input, lifecycle)
  } catch (error) {
    return { stage: 'ingest', message: errorMessage(error) }
  }
  try {
    await applyForgetsAndRecapture(execution, input, lifecycle)
    return null
  } catch (error) {
    return { stage: 'forget', message: errorMessage(error) }
  }
}

const failedScenarioJob = (
  input: ScenarioJobInput,
  candidateVersion: string,
  lifecycle: LifecycleRecorder,
  initializationFailure: InitializationFailure,
): ScenarioJobResult => ({
  candidateId: input.candidateId,
  candidateVersion,
  workerPid: process.pid,
  scenario: {
    scenarioId: input.scenario.scenarioId,
    queries: input.scenario.queries.map((query) => failedQueryEvaluation(query, initializationFailure.message)),
  },
  resources: zeroResources(),
  failures: input.scenario.queries.map((query) => ({
    scenarioId: input.scenario.scenarioId,
    queryId: query.queryId,
    stage: initializationFailure.stage,
    kind: 'exception',
    message: initializationFailure.message,
  })),
  lifecycle: lifecycle.entries,
  rebuildProbes: input.scenario.faults.rebuildBeforeQueryIds.map((queryId) => ({
    queryId,
    beforeHitIds: [],
    afterHitIds: [],
    status: 'failure',
  })),
})

const createExecution = (
  workload: ScenarioWorkload,
  createCandidate: () => MemoryCandidateAdapter,
): MutableExecution => ({
  adapter: createCandidate(),
  events: new Map([...workload.scaleEvents, ...workload.canonicalEvents].map((event) => [event.eventId, event])),
  failures: [],
  probes: [],
  retiredResources: [],
})

export type InitializationOutcome =
  | Readonly<{ ok: true; execution: MutableExecution }>
  | Readonly<{ ok: false; result: ScenarioJobResult }>

export const initializeScenarioExecution = async (
  input: ScenarioJobInput,
  workload: ScenarioWorkload,
  lifecycle: LifecycleRecorder,
  createCandidate: () => MemoryCandidateAdapter,
): Promise<InitializationOutcome> => {
  let execution: MutableExecution
  try {
    execution = createExecution(workload, createCandidate)
  } catch (error) {
    return {
      ok: false,
      result: failedScenarioJob(input, 'unavailable', lifecycle, {
        stage: 'setup',
        message: errorMessage(error),
      }),
    }
  }
  const failure = await runInitialization(execution, input, workload, lifecycle)
  return failure === null
    ? { ok: true, execution }
    : {
        ok: false,
        result: failedScenarioJob(input, execution.adapter.version, lifecycle, failure),
      }
}
