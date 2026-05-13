import { describe, expect, test } from 'bun:test'

import {
  createClusteringProfile,
  formatClusteringProfile,
  incrementClusteringCounter,
  recordClusteringCounterMax,
  recordClusteringTiming,
} from '../../../scripts/behavior-audit/clustering-profile.js'

describe('clustering profile helpers', () => {
  test('createClusteringProfile initializes max counters from input size', () => {
    const profile = createClusteringProfile({ enabled: true, linkage: 'average', threshold: 0.9, size: 3 })

    expect(profile.counters.maxActiveClusters).toBe(3)
    expect(profile.counters.maxClusterSize).toBe(1)
  })

  test('recordClusteringTiming updates one phase immutably', () => {
    const initial = createClusteringProfile({ enabled: true, linkage: 'average', threshold: 0.9, size: 3 })
    const updated = recordClusteringTiming(initial, 'nearestNeighborMs', 12.5)

    expect(initial.timings.nearestNeighborMs).toBe(0)
    expect(updated.timings.nearestNeighborMs).toBe(12.5)
    expect(updated.timings.matrixBuildMs).toBe(0)
  })

  test('recordClusteringTiming accumulates repeated phase measurements immutably', () => {
    const initial = createClusteringProfile({ enabled: true, linkage: 'average', threshold: 0.9, size: 3 })
    const firstUpdate = recordClusteringTiming(initial, 'nearestNeighborMs', 12.5)
    const secondUpdate = recordClusteringTiming(firstUpdate, 'nearestNeighborMs', 2.5)

    expect(initial.timings.nearestNeighborMs).toBe(0)
    expect(firstUpdate.timings.nearestNeighborMs).toBe(12.5)
    expect(secondUpdate.timings.nearestNeighborMs).toBe(15)
  })

  test('incrementClusteringCounter updates one counter immutably', () => {
    const initial = createClusteringProfile({ enabled: true, linkage: 'complete', threshold: 0.91, size: 4 })
    const updated = incrementClusteringCounter(initial, 'nearestNeighborCalls', 7)

    expect(initial.counters.nearestNeighborCalls).toBe(0)
    expect(updated.counters.nearestNeighborCalls).toBe(7)
    expect(updated.counters.merges).toBe(0)
  })

  test('profiling updates are no-ops when disabled', () => {
    const profile = createClusteringProfile({ enabled: false, linkage: 'average', threshold: 0.9, size: 3 })

    expect(recordClusteringTiming(profile, 'nearestNeighborMs', 12.5)).toBe(profile)
    expect(incrementClusteringCounter(profile, 'nearestNeighborCalls', 7)).toBe(profile)
    expect(recordClusteringCounterMax(profile, 'maxClusterSize', 9)).toBe(profile)
  })

  test('formatClusteringProfile prints stable timing and counter lines', () => {
    const profile = incrementClusteringCounter(
      recordClusteringTiming(
        createClusteringProfile({ enabled: true, linkage: 'average', threshold: 0.9, size: 10 }),
        'matrixBuildMs',
        3.25,
      ),
      'distanceReads',
      42,
    )

    expect(formatClusteringProfile(profile)).toEqual(
      [
        '[profile] clustering linkage=average threshold=0.9 size=10',
        '[profile] timings matrixBuildMs=3.25 nearestNeighborMs=0 mergeUpdateMs=0 gapCheckMs=0 candidateScanMs=0 subdivisionMs=0 totalMs=0',
        '[profile] counters activeListBuilds=0 activeItemsVisited=0 nearestNeighborCalls=0 distanceReads=42 distanceWrites=0 gapChecks=0 blockedPairs=0 mergeCandidatesScanned=0 merges=0 subdivisions=0 maxActiveClusters=10 maxClusterSize=1',
      ].join('\n'),
    )
  })
})
