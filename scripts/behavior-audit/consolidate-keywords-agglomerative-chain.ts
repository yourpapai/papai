import { incrementClusteringCounter, recordClusteringTiming } from './clustering-profile.js'
import type { ClusteringProfile } from './clustering-profile.js'
import { findNearestActiveCluster, getDistance } from './consolidate-keywords-agglomerative-helpers.js'
import type { ActiveState, MutableDistanceMatrix } from './consolidate-keywords-agglomerative-helpers.js'

const DISTANCE_EPSILON = 1e-6

type ChainAction =
  | Readonly<{ kind: 'blocked' }>
  | Readonly<{ kind: 'extended' }>
  | Readonly<{ kind: 'merge'; a: number; b: number }>

function blockedAction(
  profile: ClusteringProfile,
  startedAt: number,
): Readonly<{ action: Readonly<{ kind: 'blocked' }>; profile: ClusteringProfile }> {
  return {
    action: { kind: 'blocked' },
    profile: recordClusteringTiming(profile, 'candidateScanMs', performance.now() - startedAt),
  }
}

function completeChainAction(
  action: ChainAction,
  profile: ClusteringProfile,
  startedAt: number,
): Readonly<{ action: ChainAction; profile: ClusteringProfile }> {
  return {
    action,
    profile: recordClusteringTiming(profile, 'candidateScanMs', performance.now() - startedAt),
  }
}

export function tryExtendOrMergeChain(
  chain: number[],
  matrix: MutableDistanceMatrix,
  state: ActiveState,
  blockedPairs: ReadonlySet<string>,
  maxDistance: number,
  profile: ClusteringProfile,
): Readonly<{ action: ChainAction; profile: ClusteringProfile }> {
  const startedAt = performance.now()
  const current = chain.at(-1)
  if (current === undefined) return blockedAction(profile, startedAt)

  const nearestResult = findNearestActiveCluster(matrix, state, current, blockedPairs, profile)
  let currentProfile = nearestResult.profile
  if (nearestResult.nearest === undefined) return blockedAction(currentProfile, startedAt)

  currentProfile = incrementClusteringCounter(currentProfile, 'distanceReads', 1)
  if (getDistance(matrix, current, nearestResult.nearest) > maxDistance + DISTANCE_EPSILON) {
    return blockedAction(currentProfile, startedAt)
  }
  if (chain.length > 1 && nearestResult.nearest === chain.at(-2)) {
    return completeChainAction(
      { kind: 'merge', a: Math.min(current, nearestResult.nearest), b: Math.max(current, nearestResult.nearest) },
      currentProfile,
      startedAt,
    )
  }
  chain.push(nearestResult.nearest)
  return completeChainAction({ kind: 'extended' }, currentProfile, startedAt)
}
