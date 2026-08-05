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
  PersistedRunStateSchema,
  saveRunState,
} from '../../mutation-improve/src/run-state.js'
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
  agentTimeoutMs: 1_800_000,
  buildTimeoutMs: 600_000,
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
})
