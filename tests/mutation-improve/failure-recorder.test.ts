// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

import { recordFailure } from '../../mutation-improve/src/failure-recorder.js'
import type { MutationImproveRunState } from '../../mutation-improve/src/run-state.js'
import { cleanupTempDirs, makeTempDir } from './test-helpers.js'

afterEach(cleanupTempDirs)

const runState = (repoRoot: string): MutationImproveRunState => ({
  runId: 'r1',
  repoRoot,
  workDir: path.join(repoRoot, '.mutation-improve'),
  runDir: path.join(repoRoot, '.mutation-improve', 'runs', 'r1'),
  statePath: path.join(repoRoot, '.mutation-improve', 'runs', 'r1', 'state.json'),
  base: 'master',
  threshold: 0.95,
  count: 1,
  currentIteration: 0,
  doneSet: [],
  merged: [],
  failed: [],
  status: 'running',
})

describe('recordFailure', () => {
  test('writes iter/<N>/failure.json and pushes the state entry, with file when known', async () => {
    const state = runState(makeTempDir('fr-'))
    await mkdir(path.join(state.runDir, 'iter', '3'), { recursive: true })
    const entry = await recordFailure(state, 3, 'score', 'below threshold', 'src/foo.ts')
    expect(entry).toEqual({ iter: 3, gate: 'score', reason: 'below threshold', file: 'src/foo.ts' })
    expect(state.failed).toEqual([{ iter: 3, gate: 'score', reason: 'below threshold', file: 'src/foo.ts' }])
    const onDisk = JSON.parse(await readFile(path.join(state.runDir, 'iter', '3', 'failure.json'), 'utf8')) as unknown
    expect(onDisk).toEqual({ iter: 3, gate: 'score', reason: 'below threshold', file: 'src/foo.ts' })
  })

  test('omits the file key when no file is known', async () => {
    const state = runState(makeTempDir('fr-'))
    await mkdir(path.join(state.runDir, 'iter', '1'), { recursive: true })
    const entry = await recordFailure(state, 1, 'exception', 'boom')
    expect(entry).toEqual({ iter: 1, gate: 'exception', reason: 'boom' })
    const onDisk = JSON.parse(await readFile(path.join(state.runDir, 'iter', '1', 'failure.json'), 'utf8')) as unknown
    expect(onDisk).toEqual({ iter: 1, gate: 'exception', reason: 'boom' })
  })
})
