// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { BaselineMap, PerFileScore } from '../../../scripts/mutation/baseline.js'
import type { MergedScore } from '../../../scripts/mutation/score-merger.js'
import { SHARD_RESULT_VERSION } from '../../../scripts/mutation/shard-measure.js'
import type { ShardResult } from '../../../scripts/mutation/shard-measure.js'
import { SHARD_PLAN_VERSION } from '../../../scripts/mutation/shard-plan.js'
import type { ShardPlanManifest } from '../../../scripts/mutation/shard-plan.js'
import { reconcileShardResults, runShardedGate } from '../../../scripts/mutation/shard-reconcile.js'
import type { ShardGateDeps } from '../../../scripts/mutation/shard-reconcile.js'

const score = (value: number): MergedScore => ({
  killed: Math.round(value * 10),
  survived: 10 - Math.round(value * 10),
  noCoverage: 0,
  timeout: 0,
  compileError: 0,
  ignored: 0,
  runtimeError: 0,
  pending: 0,
  total: 10,
  scored: 10,
  score: value,
})

const plan = (overrides: Partial<ShardPlanManifest> = {}): ShardPlanManifest => ({
  version: SHARD_PLAN_VERSION,
  baseRef: 'origin/master',
  targets: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
  toMeasure: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
  reused: [],
  shardCount: 2,
  shards: [
    { index: 0, targets: ['src/a.ts', 'src/b.ts'], estimatedSeconds: 220 },
    { index: 1, targets: ['src/c.ts'], estimatedSeconds: 110 },
  ],
  coverageMap: {},
  budget: {
    targetWallSeconds: 360,
    preparationSeconds: 1,
    budgetSeconds: 299,
    cap: 12,
    singleShardThresholdSeconds: 330,
  },
  ...overrides,
})

const shard = (index: number, targets: readonly string[], overrides: Partial<ShardResult> = {}): ShardResult => ({
  version: SHARD_RESULT_VERSION,
  shardIndex: index,
  targets,
  perFile: targets.map((sourceFile) => ({ sourceFile, merged: score(0.9) })),
  skipped: [],
  errored: [],
  durationSeconds: 100,
  estimatedSeconds: 110,
  ...overrides,
})

interface Harness {
  readonly deps: ShardGateDeps
  readonly recorded: PerFileScore[][]
  readonly logs: string[]
}

const harness = (): Harness => {
  const recorded: PerFileScore[][] = []
  const logs: string[] = []
  return {
    recorded,
    logs,
    deps: {
      record: (entries) => {
        recorded.push([...entries])
      },
      log: (message) => {
        logs.push(message)
      },
    },
  }
}

describe('reconcileShardResults', () => {
  test('a complete result set leaves nothing missing', () => {
    const r = reconcileShardResults(plan(), [shard(0, ['src/a.ts', 'src/b.ts']), shard(1, ['src/c.ts'])])
    expect(r.missing).toEqual([])
    expect(r.perFile.map((f) => f.sourceFile).toSorted()).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts'])
  })

  // The single most dangerous failure mode: a dead shard drops its files, the ratchet finds
  // nothing to fail on, and a blocking gate goes green.
  test('a shard that never reported leaves its targets missing', () => {
    const r = reconcileShardResults(plan(), [shard(0, ['src/a.ts', 'src/b.ts'])])
    expect(r.missing).toEqual(['src/c.ts'])
  })

  test('no results at all leaves every planned target missing', () => {
    const r = reconcileShardResults(plan(), [])
    expect(r.missing).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts'])
  })

  test('a shard that reported but omitted one of its own targets leaves that one missing', () => {
    const partial = shard(0, ['src/a.ts', 'src/b.ts'], {
      perFile: [{ sourceFile: 'src/a.ts', merged: score(0.9) }],
    })
    const r = reconcileShardResults(plan(), [partial, shard(1, ['src/c.ts'])])
    expect(r.missing).toEqual(['src/b.ts'])
  })

  test('a skipped or errored target counts as accounted for, not missing', () => {
    const s = shard(0, ['src/a.ts', 'src/b.ts'], {
      perFile: [],
      skipped: [{ sourceFile: 'src/a.ts', reason: 'no covering test' }],
      errored: [{ sourceFile: 'src/b.ts', error: 'timed out' }],
    })
    const r = reconcileShardResults(plan(), [s, shard(1, ['src/c.ts'])])
    expect(r.missing).toEqual([])
    expect(r.skipped.length).toBe(1)
    expect(r.errored.length).toBe(1)
  })

  test('a plan with nothing to measure needs no results', () => {
    const r = reconcileShardResults(plan({ toMeasure: [], shards: [] }), [])
    expect(r.missing).toEqual([])
  })

  test('a duplicate shard result does not double-count a file', () => {
    const r = reconcileShardResults(plan(), [
      shard(0, ['src/a.ts', 'src/b.ts']),
      shard(0, ['src/a.ts', 'src/b.ts']),
      shard(1, ['src/c.ts']),
    ])
    expect(r.perFile.map((f) => f.sourceFile).toSorted()).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts'])
  })
})

describe('runShardedGate reconciliation', () => {
  test('fails naming the targets it never received a result for', () => {
    const h = harness()
    const verdict = runShardedGate({
      plan: plan(),
      results: [shard(0, ['src/a.ts', 'src/b.ts'])],
      baseline: {},
      threshold: 0,
      noRatchet: false,
      deps: h.deps,
    })
    expect(verdict.exitCode).toBe(1)
    expect(verdict.message).toContain('src/c.ts')
  })

  test('a silently empty result set is not a pass', () => {
    const h = harness()
    const empty = [shard(0, ['src/a.ts', 'src/b.ts'], { perFile: [] }), shard(1, ['src/c.ts'], { perFile: [] })]
    const verdict = runShardedGate({
      plan: plan(),
      results: empty,
      baseline: {},
      threshold: 0,
      noRatchet: false,
      deps: h.deps,
    })
    expect(verdict.exitCode).toBe(1)
  })

  test('a complete result set gates normally', () => {
    const h = harness()
    const verdict = runShardedGate({
      plan: plan(),
      results: [shard(0, ['src/a.ts', 'src/b.ts']), shard(1, ['src/c.ts'])],
      baseline: {},
      threshold: 0,
      noRatchet: false,
      deps: h.deps,
    })
    expect(verdict.exitCode).toBe(0)
  })

  test('still applies the existing errored, threshold and ratchet checks', () => {
    const h = harness()
    const baseline: BaselineMap = { 'src/a.ts': 0.95 }
    const verdict = runShardedGate({
      plan: plan(),
      results: [shard(0, ['src/a.ts', 'src/b.ts']), shard(1, ['src/c.ts'])],
      baseline,
      threshold: 0,
      noRatchet: false,
      deps: h.deps,
    })
    expect(verdict.exitCode).toBe(1)
    expect(verdict.message).toContain('ratchet')
  })

  test('carried-over scores from the plan are gated alongside measured ones', () => {
    const h = harness()
    const withReuse = plan({
      targets: ['src/a.ts', 'src/b.ts'],
      toMeasure: ['src/a.ts'],
      shards: [{ index: 0, targets: ['src/a.ts'], estimatedSeconds: 110 }],
      reused: [{ sourceFile: 'src/b.ts', merged: score(0.2), measuredAt: 1 }],
    })
    const verdict = runShardedGate({
      plan: withReuse,
      results: [shard(0, ['src/a.ts'])],
      baseline: { 'src/b.ts': 0.9 },
      threshold: 0,
      noRatchet: false,
      deps: h.deps,
    })
    expect(verdict.exitCode).toBe(1)
    expect(verdict.message).toContain('src/b.ts')
  })
})

describe('runShardedGate persistence', () => {
  // Recording after the verdict would mean a failing run forgets what it measured, and the next
  // push re-measures the regression from scratch. That is the one thing incremental measurement
  // must never do (ADR-0424).
  test('records every shard measurement before the verdict, even when the gate fails', () => {
    const h = harness()
    const verdict = runShardedGate({
      plan: plan(),
      results: [shard(0, ['src/a.ts', 'src/b.ts']), shard(1, ['src/c.ts'])],
      baseline: { 'src/a.ts': 0.99 },
      threshold: 0,
      noRatchet: false,
      deps: h.deps,
    })
    expect(verdict.exitCode).toBe(1)
    expect(h.recorded.length).toBe(1)
    expect(h.recorded[0]?.map((e) => e.sourceFile).toSorted()).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts'])
  })

  test('one lost shard still records the others, and never records its targets', () => {
    const h = harness()
    runShardedGate({
      plan: plan(),
      results: [shard(0, ['src/a.ts', 'src/b.ts'])],
      baseline: {},
      threshold: 0,
      noRatchet: false,
      deps: h.deps,
    })
    expect(h.recorded[0]?.map((e) => e.sourceFile).toSorted()).toEqual(['src/a.ts', 'src/b.ts'])
  })

  test('never records a skipped or errored target, so it stays retryable', () => {
    const h = harness()
    const s = shard(0, ['src/a.ts', 'src/b.ts'], {
      perFile: [{ sourceFile: 'src/a.ts', merged: score(0.9) }],
      skipped: [{ sourceFile: 'src/b.ts', reason: 'no covering test' }],
    })
    runShardedGate({
      plan: plan(),
      results: [s, shard(1, ['src/c.ts'])],
      baseline: {},
      threshold: 0,
      noRatchet: false,
      deps: h.deps,
    })
    expect(h.recorded[0]?.map((e) => e.sourceFile).toSorted()).toEqual(['src/a.ts', 'src/c.ts'])
  })
})

describe('runShardedGate reporting', () => {
  test('reports the measured-versus-reused split for the whole run, not one shard', () => {
    const h = harness()
    // Every branch-diff target lands in exactly one bucket, so targets = toMeasure ∪ reused.
    const withReuse = plan({
      targets: ['src/a.ts', 'src/b.ts'],
      toMeasure: ['src/a.ts'],
      shards: [{ index: 0, targets: ['src/a.ts'], estimatedSeconds: 110 }],
      reused: [{ sourceFile: 'src/b.ts', merged: score(0.8), measuredAt: 1 }],
    })
    runShardedGate({
      plan: withReuse,
      results: [shard(0, ['src/a.ts'])],
      baseline: {},
      threshold: 0,
      noRatchet: false,
      deps: h.deps,
    })
    const summary = h.logs.find((l) => l.includes('Whole-branch mutation targets'))
    expect(summary).toContain('2 file(s)')
    expect(summary).toContain('measured now: 1')
    expect(summary).toContain('reused: 1')
  })

  test('reports each shard estimate against what it actually cost', () => {
    const h = harness()
    runShardedGate({
      plan: plan(),
      results: [
        shard(0, ['src/a.ts', 'src/b.ts'], { estimatedSeconds: 220, durationSeconds: 400 }),
        shard(1, ['src/c.ts'], { estimatedSeconds: 110, durationSeconds: 95 }),
      ],
      baseline: {},
      threshold: 0,
      noRatchet: false,
      deps: h.deps,
    })
    const drift = h.logs.find((l) => l.includes('shard 0'))
    expect(drift).toContain('220')
    expect(drift).toContain('400')
  })
})
