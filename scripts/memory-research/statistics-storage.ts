// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export const FROZEN_100K_SCENARIO_IDS = [
  'scenario-personal-en-022',
  'scenario-personal-ru-022',
  'scenario-group-en-022',
  'scenario-group-ru-022',
] as const
export const FROZEN_100K_STORED_RECORDS = 100_000
export const FROZEN_100K_WARMUPS = 1
export const FROZEN_100K_MEASURED_RETRIEVALS = 25
export const FROZEN_100K_SEED = 20_260_723
export const STORAGE_LATENCY_THRESHOLD_MS = 250
export const STORAGE_RSS_THRESHOLD_BYTES = 1_073_741_824

export type StorageRun = Readonly<{
  scenarioId: string
  status: 'success' | 'failure' | 'missing'
  freshWorker: boolean
  fixturesMaterializedBeforeReset: boolean
  primaryScopeStoredRecordCount: number
  recordsOutsidePrimaryScope: number
  warmupCount: number
  measuredLatenciesMs: readonly number[]
  incrementalRssBytes: number
  absoluteProcessPeakRssBytes: number
  rssCapture: 'current-pre-serialization' | 'absolute-process-peak'
}>

export type StorageDecisionResult =
  | Readonly<{
      status: 'decided'
      decision: 'keep-sqlite' | 'open-migration-evaluation'
      pooledP95Ms: number
      maxIncrementalRssBytes: number
      perCellP95Ms: Readonly<Record<string, number>>
    }>
  | Readonly<{ status: 'blocked'; errors: readonly string[] }>

const nearestRank = (values: readonly number[], percentile: number): number => {
  const ordered = [...values].sort((left, right) => left - right)
  return ordered[Math.max(0, Math.ceil(percentile * ordered.length) - 1)] ?? 0
}

const storageRunErrors = (run: StorageRun): readonly string[] => [
  ...(run.status === 'success' ? [] : [`${run.scenarioId} did not complete successfully`]),
  ...(run.freshWorker ? [] : [`${run.scenarioId} did not use a fresh worker`]),
  ...(run.fixturesMaterializedBeforeReset ? [] : [`${run.scenarioId} used an invalid RSS baseline`]),
  ...(run.primaryScopeStoredRecordCount === FROZEN_100K_STORED_RECORDS
    ? []
    : [`${run.scenarioId} did not store exactly ${FROZEN_100K_STORED_RECORDS} records`]),
  ...(run.recordsOutsidePrimaryScope === 0 ? [] : [`${run.scenarioId} stored records outside its primary scope`]),
  ...(run.warmupCount === FROZEN_100K_WARMUPS ? [] : [`${run.scenarioId} used the wrong warmup count`]),
  ...(run.measuredLatenciesMs.length === FROZEN_100K_MEASURED_RETRIEVALS
    ? []
    : [`${run.scenarioId} used the wrong measured retrieval count`]),
  ...(run.measuredLatenciesMs.every((value) => Number.isFinite(value) && value >= 0)
    ? []
    : [`${run.scenarioId} has invalid latency samples`]),
  ...(Number.isFinite(run.incrementalRssBytes) && run.incrementalRssBytes >= 0
    ? []
    : [`${run.scenarioId} has invalid incremental RSS`]),
  ...(Number.isFinite(run.absoluteProcessPeakRssBytes) && run.absoluteProcessPeakRssBytes >= 0
    ? []
    : [`${run.scenarioId} has invalid absolute process peak RSS`]),
  ...(run.rssCapture === 'current-pre-serialization'
    ? []
    : [`${run.scenarioId} did not use current pre-serialization RSS`]),
]

const isFrozenScenarioId = (scenarioId: string): boolean =>
  FROZEN_100K_SCENARIO_IDS.some((frozenId) => frozenId === scenarioId)

export const evaluateStorageDecision = (runs: readonly StorageRun[]): StorageDecisionResult => {
  const actualIds = runs.map(({ scenarioId }) => scenarioId)
  const selectionErrors = [
    ...(runs.length === FROZEN_100K_SCENARIO_IDS.length ? [] : ['frozen 100k run requires exactly four cells']),
    ...(new Set(actualIds).size === actualIds.length ? [] : ['frozen 100k scenario ids must be unique']),
    ...FROZEN_100K_SCENARIO_IDS.filter((scenarioId) => !actualIds.includes(scenarioId)).map(
      (scenarioId) => `missing frozen 100k scenario: ${scenarioId}`,
    ),
    ...actualIds
      .filter((scenarioId) => !isFrozenScenarioId(scenarioId))
      .map((scenarioId) => `unexpected frozen 100k scenario: ${scenarioId}`),
  ]
  const errors = [...selectionErrors, ...runs.flatMap(storageRunErrors)]
  if (errors.length > 0) return { status: 'blocked', errors }
  const pooled = runs.flatMap(({ measuredLatenciesMs }) => measuredLatenciesMs)
  const pooledP95Ms = nearestRank(pooled, 0.95)
  const maxIncrementalRssBytes = Math.max(...runs.map(({ incrementalRssBytes }) => incrementalRssBytes))
  const perCellP95Ms = Object.fromEntries(
    runs.map(({ scenarioId, measuredLatenciesMs }) => [scenarioId, nearestRank(measuredLatenciesMs, 0.95)]),
  )
  return {
    status: 'decided',
    decision:
      pooledP95Ms <= STORAGE_LATENCY_THRESHOLD_MS && maxIncrementalRssBytes <= STORAGE_RSS_THRESHOLD_BYTES
        ? 'keep-sqlite'
        : 'open-migration-evaluation',
    pooledP95Ms,
    maxIncrementalRssBytes,
    perCellP95Ms,
  }
}
