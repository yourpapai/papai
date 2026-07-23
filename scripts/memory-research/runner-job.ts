// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { candidateVersions, createMemoryCandidate } from './candidate-registry.js'
import type { RawQueryEvaluation, RebuildProbe, RunFailure } from './report.js'
import type { ScenarioJobDependencies, ScenarioJobInput, ScenarioJobResult } from './runner-contracts.js'
import { orderedForgetRequests } from './runner-faults.js'
import { initializeScenarioExecution, type MutableExecution, zeroResources } from './runner-initialize.js'
import { createLifecycleRecorder } from './runner-lifecycle.js'
import { evaluateQuery, executeWithDeadline, failedQueryEvaluation, retrieveWithDeadline } from './runner-query.js'
import { aggregateExecutionResources } from './runner-resources.js'
import { runSequentially } from './runner-sequential.js'
import { materializeScenarioWorkload } from './runner-workload.js'
import type { MemoryCandidateAdapter, MemoryQuery, ResourceMetrics } from './types.js'

type CandidateSetup =
  | Readonly<{ ok: true; adapter: MemoryCandidateAdapter }>
  | Readonly<{ ok: false; kind: 'exception' | 'validation'; message: string }>

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const loadRegisteredCandidate = (
  input: ScenarioJobInput,
  createCandidate: () => MemoryCandidateAdapter,
): CandidateSetup => {
  try {
    const adapter = createCandidate()
    const expectedVersion = candidateVersions[input.candidateId]
    if (adapter.candidateId === input.candidateId && adapter.version === expectedVersion) {
      return { ok: true, adapter }
    }
    return {
      ok: false,
      kind: 'validation',
      message:
        `Candidate identity mismatch: requested ${input.candidateId}@${expectedVersion}, ` +
        `received ${adapter.candidateId}@${adapter.version}`,
    }
  } catch (error) {
    return { ok: false, kind: 'exception', message: errorMessage(error) }
  }
}

const failedSetupJob = (input: ScenarioJobInput, setup: Extract<CandidateSetup, { ok: false }>): ScenarioJobResult => ({
  candidateId: input.candidateId,
  candidateVersion: candidateVersions[input.candidateId],
  workerPid: process.pid,
  scenario: {
    scenarioId: input.scenario.scenarioId,
    queries: input.scenario.queries.map((query) => failedQueryEvaluation(query, setup.message)),
  },
  resources: zeroResources(),
  failures: input.scenario.queries.map((query) => ({
    scenarioId: input.scenario.scenarioId,
    queryId: query.queryId,
    stage: 'setup',
    kind: setup.kind,
    message: setup.message,
  })),
  lifecycle: [],
  rebuildProbes: input.scenario.faults.rebuildBeforeQueryIds.map((queryId) => ({
    queryId,
    beforeHitIds: [],
    afterHitIds: [],
    status: 'failure',
  })),
})

const candidateFactory = (
  input: ScenarioJobInput,
  initial: MemoryCandidateAdapter,
  createCandidate: () => MemoryCandidateAdapter,
): (() => MemoryCandidateAdapter) => {
  let availableInitial: MemoryCandidateAdapter | null = initial
  return (): MemoryCandidateAdapter => {
    if (availableInitial !== null) {
      const adapter = availableInitial
      availableInitial = null
      return adapter
    }
    const loaded = loadRegisteredCandidate(input, createCandidate)
    if (!loaded.ok) throw new Error(loaded.message)
    return loaded.adapter
  }
}

const hitIds = (result: Awaited<ReturnType<typeof retrieveWithDeadline>>['rawResult']): readonly string[] =>
  result.status === 'success' ? result.hits.map(({ evidenceId }) => evidenceId) : []

const probeStatus = (
  before: Awaited<ReturnType<typeof retrieveWithDeadline>>['rawResult'],
  after: Awaited<ReturnType<typeof retrieveWithDeadline>>['rawResult'],
): RebuildProbe['status'] =>
  before.status === 'timeout' || after.status === 'timeout'
    ? 'timeout'
    : before.status === 'failure' || after.status === 'failure'
      ? 'failure'
      : 'success'

const addFailure = (
  failures: RunFailure[],
  scenarioId: ScenarioJobInput['scenario']['scenarioId'],
  entry: RunFailure | null,
): void => {
  if (entry !== null) failures.push({ ...entry, scenarioId })
}

const resourceSnapshot = async (
  execution: MutableExecution,
  input: ScenarioJobInput,
  queryId: MemoryQuery['queryId'] | null,
  now: () => number,
): Promise<ResourceMetrics | null> => {
  const outcome = await executeWithDeadline(() => execution.adapter.resourceMetrics(), input.queryTimeoutMs, now)
  if (outcome.status === 'success') return outcome.value
  execution.failures.push({
    scenarioId: input.scenario.scenarioId,
    queryId,
    stage: 'resource',
    kind: outcome.status === 'timeout' ? 'timeout' : 'exception',
    message: outcome.status === 'timeout' ? 'Resource metrics timed out' : outcome.error,
  })
  return null
}

const retireCurrentAdapter = async (
  execution: MutableExecution,
  input: ScenarioJobInput,
  query: MemoryQuery,
  now: () => number,
): Promise<void> => {
  const resources = await resourceSnapshot(execution, input, query.queryId, now)
  if (resources !== null) execution.retiredResources.push(resources)
  await execution.adapter.reset()
}

const rebuildForQuery = async (
  execution: MutableExecution,
  input: ScenarioJobInput,
  query: MemoryQuery,
  lifecycle: ReturnType<typeof createLifecycleRecorder>,
  createCandidate: () => MemoryCandidateAdapter,
  now: () => number,
): Promise<void> => {
  const before = await retrieveWithDeadline(execution.adapter, query, input.queryTimeoutMs, now, 'rebuild')
  addFailure(execution.failures, input.scenario.scenarioId, before.failure)
  await retireCurrentAdapter(execution, input, query, now)
  execution.adapter = createCandidate()
  await execution.adapter.reset()
  lifecycle.add('restart', query.queryId, query.queryTime)
  const rebuilt = await executeWithDeadline(
    () => execution.adapter.rebuild([...execution.events.values()], orderedForgetRequests(input.scenario)),
    input.queryTimeoutMs,
    now,
  )
  lifecycle.add('rebuild', query.queryId, query.queryTime)
  if (rebuilt.status !== 'success') {
    execution.failures.push({
      scenarioId: input.scenario.scenarioId,
      queryId: query.queryId,
      stage: 'rebuild',
      kind: rebuilt.status === 'timeout' ? 'timeout' : 'exception',
      message: rebuilt.status === 'timeout' ? `Rebuild exceeded ${input.queryTimeoutMs} ms` : rebuilt.error,
    })
  }
  const after = await retrieveWithDeadline(execution.adapter, query, input.queryTimeoutMs, now, 'rebuild')
  addFailure(execution.failures, input.scenario.scenarioId, after.failure)
  execution.probes.push({
    queryId: query.queryId,
    beforeHitIds: hitIds(before.rawResult),
    afterHitIds: hitIds(after.rawResult),
    status: rebuilt.status === 'success' ? probeStatus(before.rawResult, after.rawResult) : rebuilt.status,
  })
}

const prepareQueryAdapter = async (
  execution: MutableExecution,
  input: ScenarioJobInput,
  query: MemoryQuery,
  lifecycle: ReturnType<typeof createLifecycleRecorder>,
  createCandidate: () => MemoryCandidateAdapter,
  now: () => number,
): Promise<void> => {
  const shouldRestart = input.scenario.faults.restartBeforeQueryIds.includes(query.queryId)
  const shouldRebuild = input.scenario.faults.rebuildBeforeQueryIds.includes(query.queryId)
  if (shouldRebuild) {
    await rebuildForQuery(execution, input, query, lifecycle, createCandidate, now)
    return
  }
  if (shouldRestart) {
    await retireCurrentAdapter(execution, input, query, now)
    execution.adapter = createCandidate()
    await execution.adapter.reset()
    await execution.adapter.rebuild([...execution.events.values()], orderedForgetRequests(input.scenario))
    lifecycle.add('restart', query.queryId, query.queryTime)
  }
}

const executeQueries = (
  execution: MutableExecution,
  input: ScenarioJobInput,
  lifecycle: ReturnType<typeof createLifecycleRecorder>,
  createCandidate: () => MemoryCandidateAdapter,
  now: () => number,
): Promise<readonly RawQueryEvaluation[]> =>
  runSequentially(input.scenario.queries, async (query): Promise<RawQueryEvaluation> => {
    await prepareQueryAdapter(execution, input, query, lifecycle, createCandidate, now)
    lifecycle.add('query', query.queryId, query.queryTime)
    const evaluated = await evaluateQuery(execution.adapter, query, input.queryTimeoutMs, now)
    evaluated.failures.forEach((entry) => {
      addFailure(execution.failures, input.scenario.scenarioId, entry)
    })
    return evaluated.evaluation
  })

const collectResources = async (
  execution: MutableExecution,
  input: ScenarioJobInput,
  now: () => number,
): Promise<ResourceMetrics> => {
  const current = await resourceSnapshot(execution, input, null, now)
  return aggregateExecutionResources([...execution.retiredResources, ...(current === null ? [] : [current])])
}

export const executeScenarioJob = async (
  input: ScenarioJobInput,
  dependencies: ScenarioJobDependencies = {},
): Promise<ScenarioJobResult> => {
  const workload = materializeScenarioWorkload(input.scenario, input.scale, input.seed)
  const createUnverifiedCandidate =
    dependencies.createCandidate ?? ((): MemoryCandidateAdapter => createMemoryCandidate(input.candidateId))
  const setup = loadRegisteredCandidate(input, createUnverifiedCandidate)
  if (!setup.ok) return failedSetupJob(input, setup)
  const createCandidate = candidateFactory(input, setup.adapter, createUnverifiedCandidate)
  const now = dependencies.monotonicNow ?? ((): number => performance.now())
  const lifecycle = createLifecycleRecorder(input.scenario.scenarioId)
  const initialized = await initializeScenarioExecution(input, workload, lifecycle, createCandidate)
  if (!initialized.ok) return initialized.result
  const { execution } = initialized
  const queries = await executeQueries(execution, input, lifecycle, createCandidate, now)
  const resources = await collectResources(execution, input, now)
  return {
    candidateId: execution.adapter.candidateId,
    candidateVersion: execution.adapter.version,
    workerPid: process.pid,
    scenario: { scenarioId: input.scenario.scenarioId, queries },
    resources,
    failures: execution.failures,
    lifecycle: lifecycle.entries,
    rebuildProbes: execution.probes,
  }
}
