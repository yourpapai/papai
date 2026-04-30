import { incrementClusteringCounter, recordClusteringTiming } from './clustering-profile.js'
import type { ClusteringProfile } from './clustering-profile.js'
import { dotProduct } from './consolidate-keywords-clustering.js'
import type { LinkageMode } from './consolidate-keywords-clustering.js'

type Cluster = readonly number[]
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

export function pairKey(a: number, b: number): string {
  return `${Math.min(a, b)}:${Math.max(a, b)}`
}

function compareNearest(a: { readonly distance: number; readonly candidate: number }, b: typeof a): number {
  const distanceOrder = a.distance - b.distance
  if (distanceOrder !== 0) return distanceOrder
  return a.candidate - b.candidate
}

export function findNearestActiveCluster(
  matrix: MutableDistanceMatrix,
  state: ActiveState,
  cluster: number,
  blockedPairs: ReadonlySet<string>,
  profile: ClusteringProfile,
): Readonly<{ nearest: number | undefined; profile: ClusteringProfile }> {
  const startedAt = performance.now()
  const active = activeIndices(state)
  const nearest = active
    .filter((candidate) => candidate !== cluster)
    .filter((candidate) => !blockedPairs.has(pairKey(cluster, candidate)))
    .map((candidate) => ({ candidate, distance: getDistance(matrix, cluster, candidate) }))
    .toSorted(compareNearest)[0]
  const withCounters = incrementClusteringCounter(
    incrementClusteringCounter(incrementClusteringCounter(profile, 'nearestNeighborCalls', 1), 'activeListBuilds', 1),
    'activeItemsVisited',
    active.length,
  )
  const withDistanceReads = incrementClusteringCounter(withCounters, 'distanceReads', Math.max(active.length - 1, 0))
  const nearestCandidate = nearest === undefined ? undefined : nearest.candidate
  return {
    nearest: nearestCandidate,
    profile: recordClusteringTiming(withDistanceReads, 'nearestNeighborMs', performance.now() - startedAt),
  }
}

export function updateMergedDistances(
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
  const active = activeIndices(state)
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
  matrix: MutableDistanceMatrix,
  state: ActiveState,
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
  const active = activeIndices(state)
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
  blockedPairs: ReadonlySet<string>,
  profile: ClusteringProfile,
): Readonly<{ hasCandidate: boolean; profile: ClusteringProfile }> {
  const startedAt = performance.now()
  let scanned = 0
  let distanceReads = 0
  const hasCandidate = active.some((a) =>
    active.some((b) => {
      if (a >= b) return false
      scanned += 1
      if (blockedPairs.has(pairKey(a, b))) return false
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
  state: ActiveState,
  maxDistance: number,
  blockedPairs: ReadonlySet<string>,
  profile: ClusteringProfile,
): Readonly<{ start: number | undefined; profile: ClusteringProfile }> {
  const startedAt = performance.now()
  let currentProfile = profile
  const start = active.find((cluster) => {
    const nearestResult = findNearestActiveCluster(matrix, state, cluster, blockedPairs, currentProfile)
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

export function getClusterMembers(members: ReadonlyMap<number, Cluster>, id: number): Cluster {
  const cluster = members.get(id)
  if (cluster === undefined) return []
  return cluster
}

export function filterClusters(clusters: readonly Cluster[], minClusterSize: number): readonly Cluster[] {
  return clusters.filter((cluster) => cluster.length >= minClusterSize)
}
