// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { IterationResult } from '../../mutation-improve/src/pipeline.js'
import type { MutationImproveRunState } from '../../mutation-improve/src/run-state.js'
import { buildRunSummary } from '../../mutation-improve/src/summary.js'
import { RunStats } from '../../review-loop/src/run-stats.js'

function makeRunState(): MutationImproveRunState {
  return {
    runId: 'run-1',
    runDir: '/tmp/x',
    workDir: '/tmp',
    statePath: '/tmp/x/state.json',
    repoRoot: '/tmp',
    base: 'master',
    threshold: 0.95,
    count: 2,
    currentIteration: 2,
    doneSet: ['src/a.ts'],
    merged: [
      { file: 'src/a.ts', beforeScore: 0.612, afterScore: 0.784, iter: 1 },
      { file: 'src/b.ts', beforeScore: 0.55, afterScore: 0.667, iter: 2, capped: true },
    ],
    failed: [{ iter: 3, file: 'src/c.ts', gate: 'build', reason: 'tsc failed' }],
    status: 'completed',
  }
}

describe('buildRunSummary', () => {
  test('renders per-file rows, failures and totals', () => {
    const stats = new RunStats({
      pricing: { 'm-*': { input: 3, output: 15 } },
      startedAt: 0,
      now: (): number => 760_000,
    })
    stats.addUsage('improve', { input: 228_800, output: 41_200, reasoning: 0, model: 'm-x' })
    stats.addToolCalls('improve', 37)
    stats.addDiff('iter-1', { added: 301, removed: 12 })
    const results: IterationResult[] = [
      { iter: 1, outcome: 'improved', file: 'src/a.ts' },
      { iter: 2, outcome: 'capped', file: 'src/b.ts' },
      { iter: 3, outcome: 'failed', file: 'src/c.ts', gate: 'build' },
    ]
    const summary = buildRunSummary({ runState: makeRunState(), results, stats: stats.snapshot(), aborted: false })
    expect(summary).toContain('src/a.ts')
    expect(summary).toContain('61.2% → 78.4%')
    expect(summary).toContain('improved')
    expect(summary).toContain('+301/-12')
    expect(summary).toContain('capped')
    expect(summary).toContain('src/c.ts')
    expect(summary).toContain('build')
    expect(summary).toContain('in 228.8k / out 41.2k')
    expect(summary).toContain('~$1.30 est')
    expect(summary).toContain('tools 37')
    expect(summary).toContain('12m40s')
  })

  test('omits cost when unpriced and marks aborted runs', () => {
    const stats = new RunStats({ startedAt: 0, now: (): number => 1000 })
    const summary = buildRunSummary({ runState: makeRunState(), results: [], stats: stats.snapshot(), aborted: true })
    expect(summary).toContain('aborted')
    expect(summary).not.toContain('est')
  })
})
