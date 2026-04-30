import { incrementClusteringCounter, recordClusteringCounterMax, recordClusteringTiming } from './clustering-profile.js'
import { tryExtendOrMergeChain } from './consolidate-keywords-agglomerative-chain.js'
import {
  activeIndices,
  buildCondensedDistanceMatrix,
  createActiveState,
  filterClusters,
  findChainStart,
  getClusterMembers,
  hasMergeCandidate,
  isActive,
  mergePassesGap,
  pairKey,
  updateMergedDistances,
} from './consolidate-keywords-agglomerative-helpers.js'
export {
  activeIndices,
  buildCondensedDistanceMatrix,
  condensedIndex,
  createActiveState,
  getDistance,
  isActive,
  setDistance,
} from './consolidate-keywords-agglomerative-helpers.js'
import type { ClusteringProfile } from './clustering-profile.js'
import type { LinkageMode } from './consolidate-keywords-clustering.js'
export type { ActiveState, MutableDistanceMatrix } from './consolidate-keywords-agglomerative-helpers.js'

type Cluster = readonly number[]

function recordActiveSnapshot(profile: ClusteringProfile, active: readonly number[]): ClusteringProfile {
  return incrementClusteringCounter(
    recordClusteringCounterMax(
      incrementClusteringCounter(profile, 'activeListBuilds', 1),
      'maxActiveClusters',
      active.length,
    ),
    'activeItemsVisited',
    active.length,
  )
}

function finalizeClusters(
  members: ReadonlyMap<number, Cluster>,
  state: Parameters<typeof isActive>[0],
  minClusterSize: number,
): readonly Cluster[] {
  return filterClusters(
    [...members.entries()].filter(([id]) => isActive(state, id)).map(([, cluster]) => cluster),
    minClusterSize,
  )
}

function initializeClusteringState(
  normalizedEmbeddings: readonly Float64Array[],
  threshold: number,
  profile: ClusteringProfile,
): Readonly<{
  matrix: ReturnType<typeof buildCondensedDistanceMatrix>
  state: ReturnType<typeof createActiveState>
  members: Map<number, Cluster>
  maxDistance: number
  profile: ClusteringProfile
}> {
  const matrixStartedAt = performance.now()
  const matrix = buildCondensedDistanceMatrix(normalizedEmbeddings)
  return {
    matrix,
    state: createActiveState(normalizedEmbeddings.length),
    members: new Map<number, Cluster>(normalizedEmbeddings.map((_, index) => [index, [index]])),
    maxDistance: 1 - threshold,
    profile: recordClusteringTiming(profile, 'matrixBuildMs', performance.now() - matrixStartedAt),
  }
}

function mergeChainRound(
  chain: number[],
  matrix: Parameters<typeof tryExtendOrMergeChain>[1],
  state: Parameters<typeof tryExtendOrMergeChain>[2],
  members: Map<number, Cluster>,
  blockedPairs: Set<string>,
  maxDistance: number,
  gapThreshold: number,
  linkage: Exclude<LinkageMode, 'single'>,
  profile: ClusteringProfile,
): Readonly<{ merged: boolean; blockedPairs: Set<string>; profile: ClusteringProfile }> {
  let currentProfile = profile
  for (;;) {
    const actionResult = tryExtendOrMergeChain(chain, matrix, state, blockedPairs, maxDistance, currentProfile)
    currentProfile = actionResult.profile
    const action = actionResult.action
    if (action.kind === 'blocked') {
      return { merged: false, blockedPairs, profile: currentProfile }
    }
    if (action.kind === 'extended') continue
    const gapResult = mergePassesGap(matrix, state, action.a, action.b, gapThreshold, currentProfile)
    currentProfile = gapResult.profile
    if (!gapResult.passes) {
      const updatedBlockedPairs = new Set([...blockedPairs, pairKey(action.a, action.b)])
      return {
        merged: false,
        blockedPairs: updatedBlockedPairs,
        profile: incrementClusteringCounter(currentProfile, 'blockedPairs', 1),
      }
    }
    const mergedMembers = [...getClusterMembers(members, action.a), ...getClusterMembers(members, action.b)]
    members.set(action.a, mergedMembers)
    members.delete(action.b)
    const mergedProfile = incrementClusteringCounter(
      updateMergedDistances(
        matrix,
        state,
        action.a,
        action.b,
        linkage,
        recordClusteringCounterMax(currentProfile, 'maxClusterSize', mergedMembers.length),
      ),
      'merges',
      1,
    )
    return { merged: true, blockedPairs: new Set<string>(), profile: mergedProfile }
  }
}

export function buildAgglomerativeClusters(
  normalizedEmbeddings: readonly Float64Array[],
  threshold: number,
  minClusterSize: number,
  linkage: Exclude<LinkageMode, 'single'>,
  gapThreshold: number,
  profile: ClusteringProfile,
): Readonly<{ clusters: readonly Cluster[]; profile: ClusteringProfile }> {
  if (normalizedEmbeddings.length === 0) return { clusters: [], profile }
  const initialized = initializeClusteringState(normalizedEmbeddings, threshold, profile)
  const { matrix, state, members, maxDistance } = initialized
  let blockedPairs = new Set<string>()
  let currentProfile = initialized.profile

  for (;;) {
    const active = activeIndices(state)
    currentProfile = recordActiveSnapshot(currentProfile, active)
    if (active.length <= 1) break
    const startResult = findChainStart(active, matrix, state, maxDistance, blockedPairs, currentProfile)
    currentProfile = startResult.profile
    if (startResult.start === undefined) break

    const roundResult = mergeChainRound(
      [startResult.start],
      matrix,
      state,
      members,
      blockedPairs,
      maxDistance,
      gapThreshold,
      linkage,
      currentProfile,
    )
    blockedPairs = roundResult.blockedPairs
    currentProfile = roundResult.profile
    if (roundResult.merged) continue

    const candidateResult = hasMergeCandidate(active, matrix, maxDistance, blockedPairs, currentProfile)
    currentProfile = candidateResult.profile
    if (!candidateResult.hasCandidate) break
  }

  return {
    clusters: finalizeClusters(members, state, minClusterSize),
    profile: currentProfile,
  }
}
