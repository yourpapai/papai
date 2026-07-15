// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import path from 'node:path'

import { createRunState, loadRunState, saveRunState } from '../../review-loop/src/run-state.js'
import { createReviewLoopConfigFixture, cleanupTempDirs, makeTempDir } from './test-helpers.js'

afterEach(cleanupTempDirs)

describe('run-state', () => {
  test('createRunState creates state.json with correct fields', async () => {
    const repoRoot = makeTempDir('run-state-')
    const config = createReviewLoopConfigFixture(repoRoot)
    const planPath = path.join(repoRoot, 'plan.md')

    const state = await createRunState(config, planPath)

    expect(state.runId).toBeDefined()
    expect(state.currentRound).toBe(0)
    expect(state.noProgressRounds).toBe(0)
    expect(state.worktreePath).toBe(path.join(config.workDir, 'worktree'))
    expect(state.ledgerPath).toBe(path.join(state.runDir, 'ledger.json'))
    expect(state.issuesPath).toBe(path.join(state.runDir, 'issues.json'))
    expect(existsSync(state.statePath)).toBe(true)
  })

  test('saveRunState + loadRunState round-trips persisted fields', async () => {
    const repoRoot = makeTempDir('run-state-')
    const config = createReviewLoopConfigFixture(repoRoot)
    const planPath = path.join(repoRoot, 'plan.md')

    const state = await createRunState(config, planPath)
    state.currentRound = 3
    state.noProgressRounds = 1
    await saveRunState(state)

    const loaded = await loadRunState(config.workDir, state.runId)

    expect(loaded.currentRound).toBe(3)
    expect(loaded.noProgressRounds).toBe(1)
    expect(loaded.repoRoot).toBe(config.repoRoot)
    expect(loaded.planPath).toBe(planPath)
    expect(loaded.runDir).toBe(state.runDir)
    expect(loaded.ledgerPath).toBe(state.ledgerPath)
  })
})
