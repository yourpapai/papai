// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { buildShardPlan, SHARD_PLAN_VERSION } from '../../../scripts/mutation/shard-plan.js'
import type { ShardPlanDeps, ShardPlanManifest } from '../../../scripts/mutation/shard-plan.js'

const files = (n: number, prefix = 'src/f'): string[] =>
  Array.from({ length: n }, (_v, i) => `${prefix}${String(i).padStart(3, '0')}.ts`)

interface Harness {
  readonly deps: ShardPlanDeps
  readonly logs: string[]
  readonly coverageCalls: string[][]
}

const harness = (options: {
  readonly targets: readonly string[]
  readonly reused?: readonly string[]
  readonly lines?: number
  readonly clock?: number[]
}): Harness => {
  const logs: string[] = []
  const coverageCalls: string[][] = []
  const reused = new Set(options.reused ?? [])
  const ticks = [...(options.clock ?? [0, 0])]
  return {
    logs,
    coverageCalls,
    deps: {
      selectTargets: () => options.targets,
      planIncremental: (targets) => ({
        toMeasure: targets.filter((t) => !reused.has(t)),
        reused: targets
          .filter((t) => reused.has(t))
          .map((t) => ({
            sourceFile: t,
            merged: {
              killed: 1,
              survived: 0,
              noCoverage: 0,
              timeout: 0,
              compileError: 0,
              ignored: 0,
              runtimeError: 0,
              pending: 0,
              total: 1,
              scored: 1,
              score: 1,
            },
            measuredAt: 1_700_000_000_000,
          })),
      }),
      buildCoverageMap: (sourceFiles) => {
        coverageCalls.push([...sourceFiles])
        return Object.fromEntries(sourceFiles.map((f) => [f, [`tests/${f}.test.ts`]]))
      },
      weightDeps: { countLines: () => options.lines ?? 200 },
      now: () => ticks.shift() ?? 0,
      log: (message) => {
        logs.push(message)
      },
    },
  }
}

const plan = (h: Harness, baseRef = 'origin/master'): ShardPlanManifest =>
  buildShardPlan({ projectRoot: '/repo', baseRef, deps: h.deps })

describe('buildShardPlan manifest', () => {
  test('carries the whole branch diff, the measurement set and the reuse split', () => {
    const targets = files(6)
    const h = harness({ targets, reused: targets.slice(0, 2) })
    const manifest = plan(h)

    expect(manifest.version).toBe(SHARD_PLAN_VERSION)
    expect(manifest.baseRef).toBe('origin/master')
    expect(manifest.targets).toEqual(targets)
    expect(manifest.toMeasure).toEqual(targets.slice(2))
    expect(manifest.reused.map((r) => r.sourceFile)).toEqual(targets.slice(0, 2))
  })

  test('assigns every target it plans to measure, exactly once', () => {
    const targets = files(24)
    const manifest = plan(harness({ targets }))
    const assigned = manifest.shards.flatMap((s) => s.targets)
    expect(assigned.toSorted()).toEqual([...manifest.toMeasure].toSorted())
    expect(new Set(assigned).size).toBe(manifest.toMeasure.length)
  })

  test('records the budget inputs it sized against', () => {
    const manifest = plan(harness({ targets: files(24), clock: [1000, 3500] }))
    expect(manifest.budget.preparationSeconds).toBeCloseTo(2.5, 6)
    expect(manifest.budget.budgetSeconds).toBeGreaterThan(0)
    expect(manifest.budget.cap).toBeGreaterThanOrEqual(1)
    expect(manifest.budget.targetWallSeconds).toBeGreaterThan(0)
  })

  test('publishes the coverage map for the measurement set only', () => {
    const targets = files(5)
    const h = harness({ targets, reused: targets.slice(0, 1) })
    const manifest = plan(h)
    expect(h.coverageCalls).toEqual([targets.slice(1)])
    expect(Object.keys(manifest.coverageMap).toSorted()).toEqual(targets.slice(1).toSorted())
  })
})

describe('buildShardPlan sizing', () => {
  test('a small measurement set stays on one shard', () => {
    const manifest = plan(harness({ targets: files(3), lines: 20 }))
    expect(manifest.shardCount).toBe(1)
    expect(manifest.shards.length).toBe(1)
  })

  test('a large measurement set fans out', () => {
    const manifest = plan(harness({ targets: files(38), lines: 400 }))
    expect(manifest.shardCount).toBeGreaterThan(1)
    expect(manifest.shards.length).toBe(manifest.shardCount)
  })

  // The measurement set, not the branch diff, is what gets divided — a push where everything
  // carries over must not spawn a matrix for work it is not going to do.
  test('a fully reused branch diff plans no measurement and no matrix', () => {
    const targets = files(38)
    const manifest = plan(harness({ targets, reused: targets, lines: 400 }))
    expect(manifest.toMeasure).toEqual([])
    expect(manifest.shards).toEqual([])
    expect(manifest.shardCount).toBe(1)
    expect(manifest.targets.length).toBe(38)
  })

  test('an empty branch diff plans nothing but still reports a shard count of one', () => {
    const manifest = plan(harness({ targets: [] }))
    expect(manifest.targets).toEqual([])
    expect(manifest.toMeasure).toEqual([])
    expect(manifest.shards).toEqual([])
    expect(manifest.shardCount).toBe(1)
  })

  test('no coverage map is built when there is nothing to measure', () => {
    const h = harness({ targets: [] })
    plan(h)
    expect(h.coverageCalls).toEqual([])
  })

  test('measuring everything is the default when no reuse wiring is supplied', () => {
    const targets = files(4)
    const h = harness({ targets })
    const manifest = buildShardPlan({
      projectRoot: '/repo',
      baseRef: 'origin/master',
      deps: { ...h.deps, planIncremental: undefined },
    })
    expect(manifest.toMeasure).toEqual(targets)
    expect(manifest.reused).toEqual([])
  })
})

describe('buildShardPlan reporting', () => {
  test('reports the measured-versus-reused split before anything else', () => {
    const targets = files(6)
    const h = harness({ targets, reused: targets.slice(0, 4) })
    plan(h)
    const summary = h.logs.find((l) => l.includes('Whole-branch mutation targets'))
    expect(summary).toContain('6 file(s)')
    expect(summary).toContain('measured now: 2')
    expect(summary).toContain('reused: 4')
  })

  // Estimate drift is invisible in wall clock alone: without the plan stating what it expected,
  // a slow shard cannot be told apart from a mis-estimated one. The gate logs the actuals.
  test('states each shard estimate so drift is legible in the run log', () => {
    const h = harness({ targets: files(12), lines: 400 })
    const manifest = plan(h)
    for (const shard of manifest.shards) {
      const line = h.logs.find((l) => l.includes(`shard ${shard.index}`))
      expect(line).toBeDefined()
      expect(line).toContain(`${shard.targets.length} target`)
      expect(line).toContain('est')
    }
  })

  test('reports the preparation cost it measured', () => {
    const h = harness({ targets: files(6), clock: [0, 101_500] })
    plan(h)
    const line = h.logs.find((l) => l.includes('coverage map'))
    expect(line).toContain('101.5')
  })
})
