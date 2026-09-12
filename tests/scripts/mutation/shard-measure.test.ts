// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { PairedRunInput, PairedRunResult } from '../../../scripts/mutation/paired-run.js'
import type { MergedScore } from '../../../scripts/mutation/score-merger.js'
import { measureShard, resolveShardExitCode, SHARD_RESULT_VERSION } from '../../../scripts/mutation/shard-measure.js'
import type { ShardMeasureDeps } from '../../../scripts/mutation/shard-measure.js'
import { SHARD_PLAN_VERSION } from '../../../scripts/mutation/shard-plan.js'
import type { ShardPlanManifest } from '../../../scripts/mutation/shard-plan.js'

const score = (value: number): MergedScore => ({
  killed: value === 0 ? 0 : 8,
  survived: value === 0 ? 8 : 0,
  noCoverage: 0,
  timeout: 0,
  compileError: 0,
  ignored: 0,
  runtimeError: 0,
  pending: 0,
  total: 8,
  scored: 8,
  score: value,
})

const result = (overrides: Partial<PairedRunResult> = {}): PairedRunResult => ({
  merged: score(1),
  perFile: [],
  skipped: [],
  errored: [],
  ...overrides,
})

const manifest = (shards: ShardPlanManifest['shards']): ShardPlanManifest => ({
  version: SHARD_PLAN_VERSION,
  baseRef: 'origin/master',
  targets: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
  toMeasure: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
  reused: [],
  shardCount: shards.length,
  shards,
  coverageMap: { 'src/a.ts': ['tests/a.test.ts'] },
  budget: {
    targetWallSeconds: 360,
    preparationSeconds: 1,
    budgetSeconds: 299,
    cap: 12,
    singleShardThresholdSeconds: 330,
  },
})

interface Harness {
  readonly deps: ShardMeasureDeps
  readonly calls: PairedRunInput[]
  readonly logs: string[]
}

const harness = (paired: PairedRunResult = result(), clock: number[] = [0, 0]): Harness => {
  const calls: PairedRunInput[] = []
  const logs: string[] = []
  const ticks = [...clock]
  return {
    calls,
    logs,
    deps: {
      runPaired: (input) => {
        calls.push(input)
        return Promise.resolve(paired)
      },
      now: () => ticks.shift() ?? 0,
      log: (message) => {
        logs.push(message)
      },
    },
  }
}

const twoShards: ShardPlanManifest['shards'] = [
  { index: 0, targets: ['src/a.ts', 'src/b.ts'], estimatedSeconds: 220 },
  { index: 1, targets: ['src/c.ts'], estimatedSeconds: 110 },
]

describe('measureShard', () => {
  test('measures only the targets assigned to this shard', async () => {
    const h = harness()
    await measureShard({
      projectRoot: '/repo',
      reportDir: '/reports',
      shardIndex: 1,
      plan: manifest(twoShards),
      deps: h.deps,
    })
    expect(h.calls.length).toBe(1)
    expect(h.calls[0]?.sourceFiles).toEqual(['src/c.ts'])
  })

  test('reports the shard index and its own target list', async () => {
    const h = harness()
    const shardResult = await measureShard({
      projectRoot: '/repo',
      reportDir: '/reports',
      shardIndex: 0,
      plan: manifest(twoShards),
      deps: h.deps,
    })
    expect(shardResult.version).toBe(SHARD_RESULT_VERSION)
    expect(shardResult.shardIndex).toBe(0)
    expect(shardResult.targets).toEqual(['src/a.ts', 'src/b.ts'])
  })

  // The gate's errored check is load-bearing, so a shard that drops `skipped` or `errored`
  // would let an unmeasurable file pass by simply not appearing.
  test('carries perFile, skipped and errored through to its result', async () => {
    const paired = result({
      perFile: [
        {
          sourceFile: 'src/a.ts',
          testFiles: ['tests/a.test.ts'],
          configPath: 'c',
          reportPath: 'r',
          merged: score(0.8),
        },
      ],
      skipped: [{ sourceFile: 'src/b.ts', reason: 'no covering test' }],
      errored: [{ sourceFile: 'src/c.ts', error: 'dry run timed out' }],
    })
    const h = harness(paired)
    const shardResult = await measureShard({
      projectRoot: '/repo',
      reportDir: '/reports',
      shardIndex: 0,
      plan: manifest(twoShards),
      deps: h.deps,
    })
    expect(shardResult.perFile).toEqual([{ sourceFile: 'src/a.ts', merged: score(0.8) }])
    expect(shardResult.skipped).toEqual([{ sourceFile: 'src/b.ts', reason: 'no covering test' }])
    expect(shardResult.errored).toEqual([{ sourceFile: 'src/c.ts', error: 'dry run timed out' }])
  })

  test('consumes the published coverage map instead of building its own', async () => {
    const h = harness()
    await measureShard({
      projectRoot: '/repo',
      reportDir: '/reports',
      shardIndex: 0,
      plan: manifest(twoShards),
      deps: h.deps,
    })
    const injected = h.calls[0]?.deps?.buildMap
    expect(injected).toBeDefined()
    expect(injected?.(['src/a.ts'])).toEqual({ 'src/a.ts': ['tests/a.test.ts'] })
  })

  test('records how long it actually took, for comparison against the plan estimate', async () => {
    const h = harness(result(), [1000, 46_000])
    const shardResult = await measureShard({
      projectRoot: '/repo',
      reportDir: '/reports',
      shardIndex: 0,
      plan: manifest(twoShards),
      deps: h.deps,
    })
    expect(shardResult.durationSeconds).toBeCloseTo(45, 6)
    expect(shardResult.estimatedSeconds).toBe(220)
  })

  describe('a shard index the plan does not contain', () => {
    test('measures nothing and reports an empty result', async () => {
      const h = harness()
      const shardResult = await measureShard({
        projectRoot: '/repo',
        reportDir: '/reports',
        shardIndex: 7,
        plan: manifest(twoShards),
        deps: h.deps,
      })
      expect(h.calls).toEqual([])
      expect(shardResult.targets).toEqual([])
      expect(shardResult.perFile).toEqual([])
    })
  })

  test('an empty plan runs nothing rather than measuring everything', async () => {
    const h = harness()
    const shardResult = await measureShard({
      projectRoot: '/repo',
      reportDir: '/reports',
      shardIndex: 0,
      plan: manifest([]),
      deps: h.deps,
    })
    expect(h.calls).toEqual([])
    expect(shardResult.targets).toEqual([])
  })
})

/**
 * Shards measure; the gate judges. A shard that exited non-zero on a low score would fail the
 * job before the gate ever combined the results, and the whole-branch verdict would never be
 * rendered — so the exit code must not depend on the scores at all.
 */
describe('resolveShardExitCode', () => {
  test('a low score is not a shard failure', () => {
    expect(
      resolveShardExitCode({
        version: SHARD_RESULT_VERSION,
        shardIndex: 0,
        targets: ['src/a.ts'],
        perFile: [{ sourceFile: 'src/a.ts', merged: score(0) }],
        skipped: [],
        errored: [],
        durationSeconds: 1,
        estimatedSeconds: 1,
      }),
    ).toBe(0)
  })

  test('an errored file is not a shard failure either — it is data the gate acts on', () => {
    expect(
      resolveShardExitCode({
        version: SHARD_RESULT_VERSION,
        shardIndex: 0,
        targets: ['src/a.ts'],
        perFile: [],
        skipped: [],
        errored: [{ sourceFile: 'src/a.ts', error: 'boom' }],
        durationSeconds: 1,
        estimatedSeconds: 1,
      }),
    ).toBe(0)
  })
})
