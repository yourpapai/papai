import type { LinkageMode } from './consolidate-keywords-clustering.js'

const clusteringTimingKeys = [
  'matrixBuildMs',
  'nearestNeighborMs',
  'mergeUpdateMs',
  'gapCheckMs',
  'candidateScanMs',
  'subdivisionMs',
  'totalMs',
] as const

const clusteringCounterKeys = [
  'activeListBuilds',
  'activeItemsVisited',
  'nearestNeighborCalls',
  'distanceReads',
  'distanceWrites',
  'gapChecks',
  'blockedPairs',
  'mergeCandidatesScanned',
  'merges',
  'subdivisions',
  'maxActiveClusters',
  'maxClusterSize',
] as const

export type ClusteringTimingKey = (typeof clusteringTimingKeys)[number]

export type ClusteringCounterKey = (typeof clusteringCounterKeys)[number]

export type ClusteringTimings = Readonly<Record<ClusteringTimingKey, number>>

export type ClusteringCounters = Readonly<Record<ClusteringCounterKey, number>>

export type ClusteringProfileInput = Readonly<{
  enabled: boolean
  linkage: LinkageMode
  threshold: number
  size: number
}>

export type ClusteringProfile = Readonly<
  ClusteringProfileInput & {
    timings: ClusteringTimings
    counters: ClusteringCounters
  }
>

const createZeroTimings = (): ClusteringTimings => ({
  matrixBuildMs: 0,
  nearestNeighborMs: 0,
  mergeUpdateMs: 0,
  gapCheckMs: 0,
  candidateScanMs: 0,
  subdivisionMs: 0,
  totalMs: 0,
})

const createInitialCounters = (size: number): ClusteringCounters => ({
  activeListBuilds: 0,
  activeItemsVisited: 0,
  nearestNeighborCalls: 0,
  distanceReads: 0,
  distanceWrites: 0,
  gapChecks: 0,
  blockedPairs: 0,
  mergeCandidatesScanned: 0,
  merges: 0,
  subdivisions: 0,
  maxActiveClusters: size,
  maxClusterSize: 1,
})

const updateProfile = (
  profile: ClusteringProfile,
  update: (profile: ClusteringProfile) => ClusteringProfile,
): ClusteringProfile => (profile.enabled ? update(profile) : profile)

export function createClusteringProfile(input: ClusteringProfileInput): ClusteringProfile {
  return {
    ...input,
    timings: createZeroTimings(),
    counters: createInitialCounters(input.size),
  }
}

export function recordClusteringTiming(
  profile: ClusteringProfile,
  key: ClusteringTimingKey,
  value: number,
): ClusteringProfile {
  return updateProfile(profile, (currentProfile) => ({
    ...currentProfile,
    timings: {
      ...currentProfile.timings,
      [key]: currentProfile.timings[key] + value,
    },
  }))
}

export function incrementClusteringCounter(
  profile: ClusteringProfile,
  key: ClusteringCounterKey,
  amount = 1,
): ClusteringProfile {
  return updateProfile(profile, (currentProfile) => ({
    ...currentProfile,
    counters: {
      ...currentProfile.counters,
      [key]: currentProfile.counters[key] + amount,
    },
  }))
}

export function recordClusteringCounterMax(
  profile: ClusteringProfile,
  key: ClusteringCounterKey,
  value: number,
): ClusteringProfile {
  return updateProfile(profile, (currentProfile) => ({
    ...currentProfile,
    counters: {
      ...currentProfile.counters,
      [key]: Math.max(currentProfile.counters[key], value),
    },
  }))
}

export function formatClusteringProfile(profile: ClusteringProfile): string {
  const timings = clusteringTimingKeys.map((key) => `${key}=${profile.timings[key]}`).join(' ')
  const counters = clusteringCounterKeys.map((key) => `${key}=${profile.counters[key]}`).join(' ')

  return [
    `[profile] clustering linkage=${profile.linkage} threshold=${profile.threshold} size=${profile.size}`,
    `[profile] timings ${timings}`,
    `[profile] counters ${counters}`,
  ].join('\n')
}
