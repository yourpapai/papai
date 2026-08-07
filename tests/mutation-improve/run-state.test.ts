// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import path from 'node:path'

import type { MutationImproveConfig } from '../../mutation-improve/src/config.js'
import {
  createRunState,
  iterDir,
  loadRunState,
  persistStats,
  PersistedRunStateSchema,
  saveRunState,
} from '../../mutation-improve/src/run-state.js'
import { RunStats } from '../../review-loop/src/run-stats.js'
import { cleanupTempDirs, makeTempDir } from './test-helpers.js'

afterEach(cleanupTempDirs)

const baseConfig = (repoRoot: string, workDir: string): MutationImproveConfig => ({
  repoRoot,
  workDir,
  base: 'master',
  upstream: 'origin',
  count: 1,
  threshold: 0.95,
  epsilon: 0.02,
  mutateTimeoutMs: 1_800_000,
  buildTimeoutMs: 600_000,
  buildFixAttempts: 0,
  checkCommand: 'bun check:full',
  mutateFileCommand: 'bun test:mutate:file',
  agent: { model: 'm', extraArgs: [], timeoutMs: 1_800_000 },
  prBranchPrefix: 'mutation-improve',
})

describe('run-state', () => {
  test('createRunState persists and round-trips through loadRunState', async () => {
    const repoRoot = makeTempDir('rs-')
    const config = baseConfig(repoRoot, path.join(repoRoot, '.mutation-improve'))
    const created = await createRunState(config)
    expect(created.currentIteration).toBe(0)
    expect(created.doneSet).toEqual([])
    expect(created.status).toBe('running')
    created.doneSet = ['src/a.ts']
    created.currentIteration = 1
    await saveRunState(created)
    const reloaded = await loadRunState(config.workDir, created.runId)
    expect(reloaded.doneSet).toEqual(['src/a.ts'])
    expect(reloaded.currentIteration).toBe(1)
  })

  test('iterDir is <runDir>/iter/<i>', () => {
    expect(iterDir('/runs/r1', 3)).toBe(path.join('/runs/r1', 'iter', '3'))
  })

  test('PersistedRunStateSchema rejects unknown status', () => {
    const valid = {
      runId: 'r',
      repoRoot: '/r',
      base: 'master',
      threshold: 0.95,
      count: 1,
      currentIteration: 0,
      doneSet: [],
      merged: [],
      failed: [],
      status: 'running',
    }
    expect(() => PersistedRunStateSchema.parse(valid)).not.toThrow()
    expect(() => PersistedRunStateSchema.parse({ ...valid, status: 'bogus' })).toThrow()
  })

  test('merged entries round-trip the optional capped flag; absent on pre-capped states', async () => {
    const entry = {
      file: 'src/a.ts',
      beforeScore: 0.3,
      afterScore: 0.85,
      iter: 1,
      specPath: 's.md',
      planPath: 'p.md',
    }
    const repoRoot = makeTempDir('rs-')
    const config = baseConfig(repoRoot, path.join(repoRoot, '.mutation-improve'))
    const created = await createRunState(config)
    created.merged = [{ ...entry, capped: true }, entry]
    await saveRunState(created)
    const reloaded = await loadRunState(config.workDir, created.runId)
    expect(reloaded.merged[0]?.capped).toBe(true)
    expect(reloaded.merged[1]?.capped).toBeUndefined()
  })

  test('state.json round-trips the optional stats block', async () => {
    const repoRoot = makeTempDir('run-state-stats-')
    const config = baseConfig(repoRoot, path.join(repoRoot, '.mutation-improve'))
    const state = await createRunState(config)
    const stats = new RunStats({ pricing: { 'm-*': { input: 3, output: 15 } } })
    stats.addUsage('improve', { input: 100_000, output: 10_000, reasoning: 0, model: 'm-x' })
    stats.addDiff('iter-1', { added: 301, removed: 12 })
    persistStats(state, stats)
    await saveRunState(state)
    const loaded = await loadRunState(state.workDir, state.runId)
    expect(loaded.stats?.totals.input).toBe(100_000)
    expect(loaded.stats?.totals.estimatedCostUsd).toBeCloseTo(0.45, 10)
    expect(loaded.stats?.perLabel['iter-1']).toMatchObject({ added: 301, removed: 12 })
  })

  test('state.json without a stats block loads with stats undefined', async () => {
    const repoRoot = makeTempDir('run-state-nostats-')
    const config = baseConfig(repoRoot, path.join(repoRoot, '.mutation-improve'))
    const state = await createRunState(config)
    const loaded = await loadRunState(state.workDir, state.runId)
    expect(loaded.stats).toBeUndefined()
  })
})
