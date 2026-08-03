// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { DAY_MS, utcDayStartMs } from '../retention/expiry-guard.js'

export const EXTERNAL_ACTOR_THRESHOLD = 10
export const EXTERNAL_GUEST_TURN_THRESHOLD = 10
export const EXTERNAL_GUEST_CONTEXT_THRESHOLD = 10

export const RELEASE_DIMENSION_CATALOG = {
  platform: ['telegram', 'mattermost', 'discord', 'kontur-talk'],
  contextType: ['dm', 'group', 'none'],
  actorRole: ['admin', 'member', 'guest', 'system'],
  taskProvider: ['kaneo', 'youtrack', 'none', 'other'],
} as const

export type ReleaseDimension = keyof typeof RELEASE_DIMENSION_CATALOG

export type CellDimensions = Readonly<{
  platform: string
  contextType: string
  actorRole: string
  taskProvider: string
  appVersion: string
}>

const DIMENSION_KEYS = ['platform', 'contextType', 'actorRole', 'taskProvider'] as const

export const latticeDimensionOf = (dims: CellDimensions): ReleaseDimension | 'total' | null => {
  if (dims.appVersion !== 'all') return null
  const varying = DIMENSION_KEYS.filter((key) => dims[key] !== 'all')
  if (varying.length === 0) return 'total'
  if (varying.length === 1) return varying[0] ?? null
  return null
}

export type ReleaseRequest = Readonly<{
  utcDay: string
  nowMs: number
  endUtcDay?: string
  rollingWindowDays?: number
  dimensions?: readonly ReleaseDimension[]
  appVersion?: string
  drillThrough?: boolean
}>

export type ReleaseRequestDenial =
  | 'incomplete_day'
  | 'custom_range'
  | 'rolling_window'
  | 'multi_dimension'
  | 'app_version'
  | 'drill_through'

export type ReleaseRequestAssessment = Readonly<{ ok: true }> | Readonly<{ ok: false; reason: ReleaseRequestDenial }>

export const assessReleaseRequest = (request: ReleaseRequest): ReleaseRequestAssessment => {
  if (request.drillThrough === true) return { ok: false, reason: 'drill_through' }
  if (request.dimensions !== undefined && request.dimensions.length > 1) {
    return { ok: false, reason: 'multi_dimension' }
  }
  if (request.endUtcDay !== undefined && request.endUtcDay !== request.utcDay) {
    return { ok: false, reason: 'custom_range' }
  }
  if (request.rollingWindowDays !== undefined) return { ok: false, reason: 'rolling_window' }
  if (request.appVersion !== undefined && request.appVersion !== 'all') {
    return { ok: false, reason: 'app_version' }
  }
  if (utcDayStartMs(request.utcDay) + DAY_MS > request.nowMs) return { ok: false, reason: 'incomplete_day' }
  return { ok: true }
}

export type ReleaseCellInput = Readonly<{
  utcDay: string
  metric: string
  measureKind: 'counter' | 'histogram'
  dimensions: CellDimensions
  counterValue?: number
  histogram?: Readonly<{
    fixedBuckets: readonly number[]
    counts: readonly number[]
    sum: number
    sampleCount: number
  }>
  finalized: boolean
  partialDay: boolean
  reconciliationStatus: string
  contributorBasis: string
  contributorCount: number | null
}>

export const aggregateReleaseCellKey = (cell: ReleaseCellInput): string =>
  JSON.stringify([
    cell.utcDay,
    cell.metric,
    cell.dimensions.platform,
    cell.dimensions.contextType,
    cell.dimensions.actorRole,
    cell.dimensions.taskProvider,
    cell.dimensions.appVersion,
  ])

const measureSize = (cell: ReleaseCellInput): number =>
  cell.measureKind === 'counter' ? (cell.counterValue ?? 0) : (cell.histogram?.sampleCount ?? 0)

export const isPrimarySuppressed = (cell: ReleaseCellInput): boolean => {
  if (!cell.finalized || cell.partialDay) return true
  if (cell.reconciliationStatus === 'unreconciled_restart_gap') return true
  if (cell.contributorBasis === 'eligible_actor') {
    return cell.contributorCount === null || cell.contributorCount < EXTERNAL_ACTOR_THRESHOLD
  }
  if (cell.contributorBasis === 'context') {
    return (
      cell.contributorCount === null ||
      cell.contributorCount < EXTERNAL_GUEST_CONTEXT_THRESHOLD ||
      measureSize(cell) < EXTERNAL_GUEST_TURN_THRESHOLD
    )
  }
  if (cell.contributorBasis === 'not_required') return false
  return true
}

export type SuppressionDecision = 'external_eligible' | 'suppressed'

export const thresholdFor = (cell: ReleaseCellInput): number | null => {
  if (cell.contributorBasis === 'eligible_actor') return EXTERNAL_ACTOR_THRESHOLD
  if (cell.contributorBasis === 'context') return EXTERNAL_GUEST_TURN_THRESHOLD
  return null
}

const catalogIndex = (dimension: ReleaseDimension, value: string): number => {
  const order: readonly string[] = RELEASE_DIMENSION_CATALOG[dimension]
  const index = order.indexOf(value)
  return index === -1 ? order.length : index
}

const partitionChildren = (
  cells: readonly ReleaseCellInput[],
): ReadonlyMap<string, { dimension: ReleaseDimension; children: ReleaseCellInput[] }> => {
  const partitions = new Map<string, { dimension: ReleaseDimension; children: ReleaseCellInput[] }>()
  for (const cell of cells) {
    const dimension = latticeDimensionOf(cell.dimensions)
    if (dimension === 'total' || dimension === null) continue
    const key = `${cell.metric}|${dimension}`
    const partition = partitions.get(key) ?? { dimension, children: [] }
    partition.children.push(cell)
    partitions.set(key, partition)
  }
  return partitions
}

const bySiblingOrder =
  (dimension: ReleaseDimension) =>
  (a: ReleaseCellInput, b: ReleaseCellInput): number =>
    measureSize(a) - measureSize(b) ||
    catalogIndex(dimension, a.dimensions[dimension]) - catalogIndex(dimension, b.dimensions[dimension]) ||
    aggregateReleaseCellKey(a).localeCompare(aggregateReleaseCellKey(b))

const suppressRevealingSingles = (
  cells: readonly ReleaseCellInput[],
  decisions: Map<string, SuppressionDecision>,
): void => {
  for (const [partitionKey, partition] of partitionChildren(cells)) {
    for (;;) {
      const decisionOf = (cell: ReleaseCellInput): SuppressionDecision | undefined =>
        decisions.get(aggregateReleaseCellKey(cell))
      const suppressed = partition.children.filter((cell) => decisionOf(cell) === 'suppressed')
      const releasable = partition.children.filter((cell) => decisionOf(cell) === 'external_eligible')
      if (suppressed.length !== 1) break
      const victim = [...releasable].sort(bySiblingOrder(partition.dimension))[0]
      if (victim === undefined) break
      decisions.set(aggregateReleaseCellKey(victim), 'suppressed')
    }
    const stillSingle = partition.children.filter(
      (cell) => decisions.get(aggregateReleaseCellKey(cell)) === 'suppressed',
    )
    if (stillSingle.length === 1) {
      const metric = partitionKey.split('|')[0] ?? ''
      const total = cells.find((cell) => cell.metric === metric && latticeDimensionOf(cell.dimensions) === 'total')
      if (total !== undefined) decisions.set(aggregateReleaseCellKey(total), 'suppressed')
    }
  }
}

export const applyReleaseSuppression = (
  cells: readonly ReleaseCellInput[],
): ReadonlyMap<string, SuppressionDecision> => {
  const decisions = new Map<string, SuppressionDecision>()
  for (const cell of cells) {
    const onLattice = latticeDimensionOf(cell.dimensions) !== null
    decisions.set(
      aggregateReleaseCellKey(cell),
      onLattice && !isPrimarySuppressed(cell) ? 'external_eligible' : 'suppressed',
    )
  }
  suppressRevealingSingles(cells, decisions)
  return decisions
}
