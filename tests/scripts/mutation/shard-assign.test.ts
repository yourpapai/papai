// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { assignTargets } from '../../../scripts/mutation/shard-assign.js'

const weightsOf = (entries: Record<string, number>): ReadonlyMap<string, number> => new Map(Object.entries(entries))
const uniform = (n: number, weight = 100): { targets: string[]; weights: ReadonlyMap<string, number> } => {
  const targets = Array.from({ length: n }, (_v, i) => `src/f${String(i).padStart(3, '0')}.ts`)
  return { targets, weights: new Map(targets.map((t) => [t, weight])) }
}
const loads = (shards: readonly { readonly estimatedSeconds: number }[]): number[] =>
  shards.map((s) => s.estimatedSeconds)

describe('assignTargets', () => {
  test('assigns every target exactly once', () => {
    const { targets, weights } = uniform(37)
    const shards = assignTargets(targets, weights, 7)
    const assigned = shards.flatMap((s) => s.targets)
    expect(assigned.toSorted()).toEqual([...targets].toSorted())
    expect(new Set(assigned).size).toBe(targets.length)
  })

  test('leaves no shard empty when there are at least as many targets as shards', () => {
    for (const [n, k] of [
      [37, 7],
      [12, 12],
      [13, 12],
      [2, 2],
    ] as const) {
      const { targets, weights } = uniform(n)
      const shards = assignTargets(targets, weights, k)
      expect(shards.length).toBe(k)
      for (const shard of shards) expect(shard.targets.length).toBeGreaterThan(0)
    }
  })

  // Balancing by count alone would put both 900s targets on one shard whenever they sort
  // together; balancing by cost must not.
  test('spreads expensive targets when costs differ by an order of magnitude', () => {
    const weights = weightsOf({
      'src/huge-a.ts': 900,
      'src/huge-b.ts': 900,
      'src/tiny-a.ts': 20,
      'src/tiny-b.ts': 20,
      'src/tiny-c.ts': 20,
      'src/tiny-d.ts': 20,
    })
    const shards = assignTargets([...weights.keys()], weights, 2)
    for (const shard of shards) {
      expect(shard.targets.filter((t) => t.includes('huge')).length).toBe(1)
    }
    const spread = Math.max(...loads(shards)) - Math.min(...loads(shards))
    expect(spread).toBeLessThanOrEqual(60)
  })

  test('beats count-balancing on a skewed distribution', () => {
    const targets = Array.from({ length: 12 }, (_v, i) => `src/f${i}.ts`)
    // Descending cost: naive round-robin over this order stacks the expensive end together.
    const weights = new Map(targets.map((t, i) => [t, (12 - i) * 50]))
    const shards = assignTargets(targets, weights, 4)
    const makespan = Math.max(...loads(shards))
    const total = [...weights.values()].reduce((a, b) => a + b, 0)
    // Within 15% of a perfectly even split.
    expect(makespan).toBeLessThanOrEqual((total / 4) * 1.15)
  })

  test('is deterministic for a given input', () => {
    const { targets, weights } = uniform(23, 77)
    const first = assignTargets(targets, weights, 5)
    const second = assignTargets(targets, weights, 5)
    expect(second).toEqual(first)
  })

  test('does not depend on the order targets are supplied in', () => {
    const { targets, weights } = uniform(23, 77)
    const forward = assignTargets(targets, weights, 5)
    const reversed = assignTargets([...targets].toReversed(), weights, 5)
    expect(reversed.map((s) => [...s.targets].toSorted())).toEqual(forward.map((s) => [...s.targets].toSorted()))
  })

  test('a target with no recorded weight is still assigned', () => {
    const targets = ['src/a.ts', 'src/unweighted.ts']
    const shards = assignTargets(targets, weightsOf({ 'src/a.ts': 100 }), 2)
    expect(shards.flatMap((s) => s.targets).toSorted()).toEqual(targets.toSorted())
  })

  test('reports each shard its own index and estimated load', () => {
    const { targets, weights } = uniform(6, 50)
    const shards = assignTargets(targets, weights, 3)
    expect(shards.map((s) => s.index)).toEqual([0, 1, 2])
    for (const shard of shards) {
      expect(shard.estimatedSeconds).toBeCloseTo(shard.targets.length * 50, 6)
    }
  })

  describe('degenerate shard counts', () => {
    test('a single shard receives everything', () => {
      const { targets, weights } = uniform(9)
      const shards = assignTargets(targets, weights, 1)
      expect(shards.length).toBe(1)
      expect(shards[0]?.targets.toSorted()).toEqual([...targets].toSorted())
    })

    test('more shards than targets never yields an empty shard', () => {
      const { targets, weights } = uniform(3)
      const shards = assignTargets(targets, weights, 12)
      expect(shards.length).toBe(3)
      for (const shard of shards) expect(shard.targets.length).toBeGreaterThan(0)
    })

    test('no targets yields no shards', () => {
      expect(assignTargets([], new Map(), 4)).toEqual([])
    })
  })
})

/**
 * The `mutation-shard-planning` spec makes division a scheduling concern that must never reach
 * the verdict. What the assignment layer can prove is the half it owns: whatever the shard count
 * and whatever the weights, the union of assigned targets is exactly the planned set. The gate
 * side of the property — that the combined per-file input is identical — is pinned in
 * shard-reconcile.test.ts.
 */
describe('division never changes the target set', () => {
  test('the union is identical across every shard count', () => {
    const { targets, weights } = uniform(24, 130)
    const expected = [...targets].toSorted()
    for (const k of [1, 2, 3, 5, 8, 12, 24]) {
      const union = assignTargets(targets, weights, k)
        .flatMap((s) => s.targets)
        .toSorted()
      expect(union).toEqual(expected)
    }
  })

  test('badly wrong weights change the split but never the set', () => {
    const { targets } = uniform(16)
    const sane = new Map(targets.map((t) => [t, 100]))
    const nonsense = new Map(targets.map((t) => [t, 1]))
    // One target estimated three orders of magnitude too heavy: the split must move, the set must not.
    nonsense.set('src/f000.ts', 100_000)
    const a = assignTargets(targets, sane, 4)
      .flatMap((s) => s.targets)
      .toSorted()
    const b = assignTargets(targets, nonsense, 4)
      .flatMap((s) => s.targets)
      .toSorted()
    expect(b).toEqual(a)
  })
})
