// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { comparisonIdentityErrors } from './statistics-comparison.js'

export const BOOTSTRAP_SEED = 20_260_723
export const BOOTSTRAP_RESAMPLES = 10_000

export type CandidateId = 'as-shipped' | 'corrected-hybrid' | 'hierarchical' | 'temporal-graph'
export type NonGraphCandidateId = Exclude<CandidateId, 'temporal-graph'>
export type QueryStatus = 'success' | 'failure' | 'timeout'
export type QualityMetric = 'precisionAtK' | 'recallAtK' | 'reciprocalRank' | 'ndcgAtK'

export type ValidationResult<Value> =
  | Readonly<{ valid: true; value: Value }>
  | Readonly<{ valid: false; errors: readonly string[] }>

export type QueryObservation = Readonly<{
  scenarioId: string
  queryId: string
  status: QueryStatus
  slices: readonly string[]
  precisionAtK: number
  recallAtK: number
  reciprocalRank: number
  ndcgAtK: number
}>

export type ComparisonIdentity = Readonly<{
  scenarioManifestVersion: string
  scenarioManifestSha256: string
  selectionSha256: string
  split: string
  scale: number
  seed: number
}>

export type CandidateObservationSet = Readonly<{
  candidateId: CandidateId
  identity: ComparisonIdentity
  rows: readonly QueryObservation[]
}>

export type StatisticSpec =
  | Readonly<{ kind: 'overall'; metric: QualityMetric }>
  | Readonly<{ kind: 'slice'; metric: QualityMetric; slice: string }>
  | Readonly<{ kind: 'composite'; metric: QualityMetric; slices: readonly string[] }>

export type PairedInterval = Readonly<{
  seed: number
  resamples: number
  unit: 'scenario'
  pointDelta: number
  lower95: number
  upper95: number
}>

export type BootstrapOptions = Readonly<{
  seed?: number
  resamples?: number
  mode?: 'frozen' | 'fixture'
}>

const valid = <Value>(value: Value): ValidationResult<Value> => ({ valid: true, value })
const invalid = <Value = never>(...errors: readonly string[]): ValidationResult<Value> => ({ valid: false, errors })
const isFiniteUnit = (value: number): boolean => Number.isFinite(value) && value >= 0 && value <= 1

const nextXorShift32 = (state: number): number => {
  const shiftedLeft = (state ^ (state << 13)) >>> 0
  const shiftedRight = (shiftedLeft ^ (shiftedLeft >>> 17)) >>> 0
  return (shiftedRight ^ (shiftedRight << 5)) >>> 0
}

export const generateScenarioIndexes = (
  scenarioCount: number,
  drawCount: number,
  seed = BOOTSTRAP_SEED,
): readonly number[] => {
  let state = seed >>> 0
  return Array.from({ length: drawCount }, () => {
    state = nextXorShift32(state)
    return Math.floor((state / 2 ** 32) * scenarioCount)
  })
}

export const type7Quantile = (values: readonly number[], probability: number): ValidationResult<number> => {
  if (values.length === 0) return invalid('quantile requires at least one value')
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    return invalid('quantile probability must be finite and between zero and one')
  }
  if (values.some((value) => !Number.isFinite(value))) return invalid('quantile values must be finite')
  const ordered = [...values].sort((left, right) => left - right)
  const position = (ordered.length - 1) * probability
  const lowerIndex = Math.floor(position)
  const upperIndex = Math.ceil(position)
  const lower = ordered[lowerIndex]
  const upper = ordered[upperIndex]
  if (lower === undefined || upper === undefined) return invalid('quantile index is out of bounds')
  return valid(lower + (position - lowerIndex) * (upper - lower))
}

export const intervalStrictlyPositive = (interval: Pick<PairedInterval, 'lower95' | 'upper95'>): boolean =>
  Number.isFinite(interval.lower95) &&
  Number.isFinite(interval.upper95) &&
  interval.lower95 <= interval.upper95 &&
  interval.lower95 > 0

const observationErrors = (rows: readonly QueryObservation[]): readonly string[] =>
  rows.flatMap((row, index) => [
    ...(row.scenarioId.length > 0 ? [] : [`row ${index} has an empty scenario id`]),
    ...(row.queryId.length > 0 ? [] : [`row ${index} has an empty query id`]),
    ...([row.precisionAtK, row.recallAtK, row.reciprocalRank, row.ndcgAtK].every(isFiniteUnit)
      ? []
      : [`row ${index} has an invalid quality metric`]),
  ])

const successfulMetric = (row: QueryObservation, metric: QualityMetric): number =>
  row.status === 'success' ? row[metric] : 0

const meanMetric = (
  rows: readonly QueryObservation[],
  metric: QualityMetric,
  emptyMessage: string,
): ValidationResult<number> =>
  rows.length === 0
    ? invalid(emptyMessage)
    : valid(rows.reduce((sum, row) => sum + successfulMetric(row, metric), 0) / rows.length)

export const aggregateStatistic = (
  rows: readonly QueryObservation[],
  spec: StatisticSpec,
): ValidationResult<number> => {
  const errors = observationErrors(rows)
  if (errors.length > 0) return invalid(...errors)
  if (spec.kind === 'overall') return meanMetric(rows, spec.metric, 'overall statistic has no queries')
  if (spec.kind === 'slice') {
    return meanMetric(
      rows.filter(({ slices }) => slices.includes(spec.slice)),
      spec.metric,
      `required slice is empty: ${spec.slice}`,
    )
  }
  if (spec.slices.length === 0) return invalid('composite requires at least one slice')
  if (new Set(spec.slices).size !== spec.slices.length) return invalid('composite slices must be unique')
  const sliceResults = spec.slices.map((slice) =>
    meanMetric(
      rows.filter(({ slices }) => slices.includes(slice)),
      spec.metric,
      `required slice is empty: ${slice}`,
    ),
  )
  const sliceErrors = sliceResults.flatMap((result) => (result.valid ? [] : result.errors))
  if (sliceErrors.length > 0) return invalid(...sliceErrors)
  const values = sliceResults.flatMap((result) => (result.valid ? [result.value] : []))
  return valid(values.reduce((sum, value) => sum + value, 0) / values.length)
}

const rowsByScenario = (
  rows: readonly QueryObservation[],
  scenarioIds: readonly string[],
): Readonly<Record<string, readonly QueryObservation[]>> =>
  Object.fromEntries(scenarioIds.map((scenarioId) => [scenarioId, rows.filter((row) => row.scenarioId === scenarioId)]))

const sampledRows = (
  indexes: readonly number[],
  scenarioIds: readonly string[],
  byScenario: Readonly<Record<string, readonly QueryObservation[]>>,
): readonly QueryObservation[] =>
  indexes.flatMap((index) => {
    const scenarioId = scenarioIds[index]
    return scenarioId === undefined ? [] : (byScenario[scenarioId] ?? [])
  })

const bootstrapDeltas = (
  candidate: CandidateObservationSet,
  comparator: CandidateObservationSet,
  spec: StatisticSpec,
  scenarioIds: readonly string[],
  resamples: number,
  seed: number,
): ValidationResult<readonly number[]> => {
  const flatIndexes = generateScenarioIndexes(scenarioIds.length, resamples * scenarioIds.length, seed)
  const candidateRows = rowsByScenario(candidate.rows, scenarioIds)
  const comparatorRows = rowsByScenario(comparator.rows, scenarioIds)
  const results = Array.from({ length: resamples }, (_, replicate) => {
    const indexes = flatIndexes.slice(replicate * scenarioIds.length, (replicate + 1) * scenarioIds.length)
    const candidateValue = aggregateStatistic(sampledRows(indexes, scenarioIds, candidateRows), spec)
    const comparatorValue = aggregateStatistic(sampledRows(indexes, scenarioIds, comparatorRows), spec)
    const candidateErrors = candidateValue.valid ? [] : candidateValue.errors
    const comparatorErrors = comparatorValue.valid ? [] : comparatorValue.errors
    if (candidateErrors.length > 0 || comparatorErrors.length > 0) {
      return invalid<number>(...candidateErrors, ...comparatorErrors)
    }
    if (!candidateValue.valid || !comparatorValue.valid) return invalid<number>('invalid bootstrap statistic')
    return valid(candidateValue.value - comparatorValue.value)
  })
  const errors = results.flatMap((result) => (result.valid ? [] : result.errors))
  return errors.length > 0
    ? invalid(...[...new Set(errors)])
    : valid(results.flatMap((result) => (result.valid ? [result.value] : [])))
}

const frozenBootstrapErrors = (
  identity: ComparisonIdentity,
  scenarioCount: number,
  seed: number,
  resamples: number,
  mode: BootstrapOptions['mode'],
): readonly string[] =>
  mode === 'fixture'
    ? []
    : [
        ...(identity.split === 'sealed-test' ? [] : ['frozen bootstrap requires sealed-test']),
        ...(identity.scale === 10_000 ? [] : ['frozen bootstrap requires scale 10000']),
        ...(identity.seed === BOOTSTRAP_SEED ? [] : ['frozen bootstrap requires seed 20260723']),
        ...(seed === BOOTSTRAP_SEED ? [] : ['frozen bootstrap stream seed must be 20260723']),
        ...(resamples === BOOTSTRAP_RESAMPLES ? [] : ['frozen bootstrap requires 10000 resamples']),
        ...(scenarioCount === 180 ? [] : ['frozen bootstrap requires exactly 180 scenarios']),
      ]

export const pairedBootstrapDelta = (
  candidate: CandidateObservationSet,
  comparator: CandidateObservationSet,
  spec: StatisticSpec,
  options: BootstrapOptions = {},
): ValidationResult<PairedInterval> => {
  const resamples = options.resamples ?? BOOTSTRAP_RESAMPLES
  const seed = options.seed ?? BOOTSTRAP_SEED
  const comparisonErrors = comparisonIdentityErrors(candidate, comparator)
  const inputErrors = [...observationErrors(candidate.rows), ...observationErrors(comparator.rows)]
  if (comparisonErrors.length > 0 || inputErrors.length > 0) return invalid(...comparisonErrors, ...inputErrors)
  if (!Number.isInteger(resamples) || resamples <= 0) return invalid('resamples must be a positive integer')
  const scenarioIds = [...new Set(candidate.rows.map(({ scenarioId }) => scenarioId))].sort((left, right) =>
    left.localeCompare(right),
  )
  if (scenarioIds.length === 0) return invalid('paired bootstrap requires at least one scenario')
  const frozenErrors = frozenBootstrapErrors(candidate.identity, scenarioIds.length, seed, resamples, options.mode)
  if (frozenErrors.length > 0) return invalid(...frozenErrors)
  const candidatePoint = aggregateStatistic(candidate.rows, spec)
  const comparatorPoint = aggregateStatistic(comparator.rows, spec)
  const candidatePointErrors = candidatePoint.valid ? [] : candidatePoint.errors
  const comparatorPointErrors = comparatorPoint.valid ? [] : comparatorPoint.errors
  if (candidatePointErrors.length > 0 || comparatorPointErrors.length > 0) {
    return invalid(...candidatePointErrors, ...comparatorPointErrors)
  }
  if (!candidatePoint.valid || !comparatorPoint.valid) return invalid('invalid point statistic')
  const deltas = bootstrapDeltas(candidate, comparator, spec, scenarioIds, resamples, seed)
  if (!deltas.valid) return deltas
  const lower = type7Quantile(deltas.value, 0.025)
  const upper = type7Quantile(deltas.value, 0.975)
  const lowerErrors = lower.valid ? [] : lower.errors
  const upperErrors = upper.valid ? [] : upper.errors
  if (lowerErrors.length > 0 || upperErrors.length > 0) return invalid(...lowerErrors, ...upperErrors)
  if (!lower.valid || !upper.valid) return invalid('invalid percentile interval')
  return valid({
    seed,
    resamples,
    unit: 'scenario',
    pointDelta: candidatePoint.value - comparatorPoint.value,
    lower95: lower.value,
    upper95: upper.value,
  })
}

export * from './statistics-decision.js'
