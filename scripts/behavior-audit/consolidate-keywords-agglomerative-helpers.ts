// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { incrementClusteringCounter, recordClusteringTiming } from './clustering-profile.js'
import type { ClusteringProfile } from './clustering-profile.js'
import { dotProduct } from './consolidate-keywords-clustering.js'
import type { LinkageMode } from './consolidate-keywords-clustering.js'

const DISTANCE_EPSILON = 1e-6

export type MutableDistanceMatrix = {
  readonly n: number
  readonly values: Float32Array
}

export type ActiveState = {
  readonly active: Uint8Array
  readonly sizes: Uint32Array
}

export function condensedIndex(i: number, j: number, n: number): number {
  const a = Math.min(i, j)
  const b = Math.max(i, j)
  return (a * (2 * n - a - 1)) / 2 + (b - a - 1)
}

export function getDistance(matrix: MutableDistanceMatrix, i: number, j: number): number {
  if (i === j) return 0
  const value = matrix.values[condensedIndex(i, j, matrix.n)]
  if (value === undefined) return Infinity
  return value
}

export function setDistance(matrix: MutableDistanceMatrix, i: number, j: number, distance: number): void {
  if (i === j) return
  matrix.values[condensedIndex(i, j, matrix.n)] = distance
}

export function buildCondensedDistanceMatrix(normalizedEmbeddings: readonly Float64Array[]): MutableDistanceMatrix {
  const n = normalizedEmbeddings.length
  const values = new Float32Array((n * (n - 1)) / 2)
  for (let i = 0; i < n; i++) {
    const embI = normalizedEmbeddings[i]
    if (embI === undefined) continue
    for (let j = i + 1; j < n; j++) {
      const embJ = normalizedEmbeddings[j]
      const similarity = embJ === undefined ? 0 : dotProduct(embI, embJ)
      values[condensedIndex(i, j, n)] = 1 - similarity
    }
  }
  return { n, values }
}

export function createActiveState(n: number): ActiveState {
  return {
    active: Uint8Array.from({ length: n }, () => 1),
    sizes: Uint32Array.from({ length: n }, () => 1),
  }
}

export function activeIndices(state: ActiveState): readonly number[] {
  return Array.from(state.active.entries()).flatMap(([index, marker]) => (marker === 1 ? [index] : []))
}

export function isActive(state: ActiveState, index: number): boolean {
  return state.active[index] === 1
}

export function pairKey(a: number, b: number, n: number): number {
  return condensedIndex(a, b, n)
}

type NearestCandidate = Readonly<{ readonly candidate: number; readonly distance: number }>

function compareNearest(a: NearestCandidate, b: NearestCandidate): number {
  const distanceOrder = a.distance - b.distance
  if (distanceOrder === 0) return a.candidate - b.candidate
  return distanceOrder
}

function selectNearestCandidate(
  active: readonly number[],
  matrix: MutableDistanceMatrix,
  cluster: number,
  blockedPairs: ReadonlySet<number>,
): Readonly<{ nearest: number | undefined; distanceReads: number }> {
  let nearest: number | undefined
  let bestDistance = Infinity
  let distanceReads = 0

  for (const candidate of active) {
    if (candidate === cluster) continue
    if (blockedPairs.has(pairKey(cluster, candidate, matrix.n))) continue

    const distance = getDistance(matrix, cluster, candidate)
    distanceReads += 1
    if (Number.isNaN(distance)) {
      const fallbackCandidates: NearestCandidate[] = []
      for (const other of active) {
        if (other === cluster) continue
        if (blockedPairs.has(pairKey(cluster, other, matrix.n))) continue

        const fallbackDistance = other === candidate ? distance : getDistance(matrix, cluster, other)
        if (other !== candidate) distanceReads += 1
        fallbackCandidates.push({ candidate: other, distance: fallbackDistance })
      }
      const fallbackNearest = fallbackCandidates.toSorted(compareNearest)[0]
      return {
        nearest: fallbackNearest === undefined ? undefined : fallbackNearest.candidate,
        distanceReads,
      }
    }

    if (nearest === undefined) {
      nearest = candidate
      bestDistance = distance
      continue
    }

    if (distance < bestDistance || (distance === bestDistance && candidate < nearest)) {
      nearest = candidate
      bestDistance = distance
    }
  }

  return { nearest, distanceReads }
}

export function findNearestActiveCluster(
  active: readonly number[],
  matrix: MutableDistanceMatrix,
  cluster: number,
  blockedPairs: ReadonlySet<number>,
  profile: ClusteringProfile,
): Readonly<{ nearest: number | undefined; profile: ClusteringProfile }> {
  const startedAt = performance.now()
  const { nearest, distanceReads } = selectNearestCandidate(active, matrix, cluster, blockedPairs)

  const withCounters = incrementClusteringCounter(
    incrementClusteringCounter(incrementClusteringCounter(profile, 'nearestNeighborCalls', 1), 'activeListBuilds', 1),
    'activeItemsVisited',
    active.length,
  )
  return {
    nearest,
    profile: recordClusteringTiming(
      incrementClusteringCounter(withCounters, 'distanceReads', distanceReads),
      'nearestNeighborMs',
      performance.now() - startedAt,
    ),
  }
}

export function updateMergedDistances(
  active: readonly number[],
  matrix: MutableDistanceMatrix,
  state: ActiveState,
  survivor: number,
  removed: number,
  linkage: Exclude<LinkageMode, 'single'>,
  profile: ClusteringProfile,
): ClusteringProfile {
  const startedAt = performance.now()
  const survivorSize = state.sizes[survivor]
  const removedSize = state.sizes[removed]
  if (survivorSize === undefined || removedSize === undefined) return profile
  for (const other of active) {
    if (other === survivor || other === removed) continue
    const distanceToSurvivor = getDistance(matrix, survivor, other)
    const distanceToRemoved = getDistance(matrix, removed, other)
    const updatedDistance =
      linkage === 'average'
        ? (survivorSize * distanceToSurvivor + removedSize * distanceToRemoved) / (survivorSize + removedSize)
        : Math.max(distanceToSurvivor, distanceToRemoved)
    setDistance(matrix, survivor, other, updatedDistance)
  }
  state.sizes[survivor] = survivorSize + removedSize
  state.sizes[removed] = 0
  state.active[removed] = 0
  const withCounters = incrementClusteringCounter(
    incrementClusteringCounter(
      incrementClusteringCounter(profile, 'activeListBuilds', 1),
      'activeItemsVisited',
      active.length,
    ),
    'distanceWrites',
    Math.max(active.length - 2, 0),
  )
  return recordClusteringTiming(withCounters, 'mergeUpdateMs', performance.now() - startedAt)
}

export function mergePassesGap(
  active: readonly number[],
  matrix: MutableDistanceMatrix,
  a: number,
  b: number,
  gapThreshold: number,
  profile: ClusteringProfile,
): Readonly<{ passes: boolean; profile: ClusteringProfile }> {
  const startedAt = performance.now()
  if (gapThreshold <= 0) {
    return {
      passes: true,
      profile: recordClusteringTiming(
        incrementClusteringCounter(profile, 'gapChecks', 1),
        'gapCheckMs',
        performance.now() - startedAt,
      ),
    }
  }
  const candidateDistance = getDistance(matrix, a, b)
  const alternativeDistance = active.reduce((best, candidate) => {
    if (candidate === a || candidate === b) return best
    return Math.min(best, getDistance(matrix, a, candidate), getDistance(matrix, b, candidate))
  }, Infinity)
  const withCounters = incrementClusteringCounter(
    incrementClusteringCounter(incrementClusteringCounter(profile, 'gapChecks', 1), 'activeListBuilds', 1),
    'activeItemsVisited',
    active.length,
  )
  const withDistanceReads = incrementClusteringCounter(
    withCounters,
    'distanceReads',
    1 + Math.max((active.length - 2) * 2, 0),
  )
  const passes =
    alternativeDistance === Infinity ? true : alternativeDistance - candidateDistance + DISTANCE_EPSILON >= gapThreshold
  return {
    passes,
    profile: recordClusteringTiming(withDistanceReads, 'gapCheckMs', performance.now() - startedAt),
  }
}

export function hasMergeCandidate(
  active: readonly number[],
  matrix: MutableDistanceMatrix,
  maxDistance: number,
  blockedPairs: ReadonlySet<number>,
  profile: ClusteringProfile,
): Readonly<{ hasCandidate: boolean; profile: ClusteringProfile }> {
  const startedAt = performance.now()
  let scanned = 0
  let distanceReads = 0
  const hasCandidate = active.some((a) =>
    active.some((b) => {
      if (a >= b) return false
      scanned += 1
      if (blockedPairs.has(pairKey(a, b, matrix.n))) return false
      distanceReads += 1
      return getDistance(matrix, a, b) <= maxDistance + DISTANCE_EPSILON
    }),
  )
  const withCounters = incrementClusteringCounter(
    incrementClusteringCounter(
      incrementClusteringCounter(profile, 'mergeCandidatesScanned', scanned),
      'activeItemsVisited',
      active.length,
    ),
    'distanceReads',
    distanceReads,
  )
  return {
    hasCandidate,
    profile: recordClusteringTiming(withCounters, 'candidateScanMs', performance.now() - startedAt),
  }
}

export function findChainStart(
  active: readonly number[],
  matrix: MutableDistanceMatrix,
  maxDistance: number,
  blockedPairs: ReadonlySet<number>,
  profile: ClusteringProfile,
): Readonly<{ start: number | undefined; profile: ClusteringProfile }> {
  const startedAt = performance.now()
  let currentProfile = profile
  const start = active.find((cluster) => {
    const nearestResult = findNearestActiveCluster(active, matrix, cluster, blockedPairs, currentProfile)
    currentProfile = nearestResult.profile
    if (nearestResult.nearest === undefined) return false
    currentProfile = incrementClusteringCounter(currentProfile, 'distanceReads', 1)
    return getDistance(matrix, cluster, nearestResult.nearest) <= maxDistance + DISTANCE_EPSILON
  })
  return {
    start,
    profile: recordClusteringTiming(currentProfile, 'candidateScanMs', performance.now() - startedAt),
  }
}
