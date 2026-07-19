// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { ensureFixerChangesCommitted } from '../../review-loop/src/commit-attempt.js'
import { createIssueLedger, type LedgerIssueRecord } from '../../review-loop/src/issue-ledger.js'
import type { IssueProcessorDeps } from '../../review-loop/src/issue-processor.js'
import type { ReviewerIssue } from '../../review-loop/src/issue-schema.js'
import { createRunState } from '../../review-loop/src/run-state.js'
import type { TraceLogger } from '../../review-loop/src/trace-log.js'
import { execGit } from '../../review-loop/src/worktree.js'
import {
  cleanupTempDirs,
  createReviewLoopConfigFixture,
  fakePool,
  makeTempDir,
  silentReporter,
} from './test-helpers.js'

afterEach(cleanupTempDirs)

async function setupRepo(repoPath: string): Promise<void> {
  mkdirSync(repoPath, { recursive: true })
  await execGit(repoPath, ['init'])
  await execGit(repoPath, ['config', 'user.email', 't@t.com'])
  await execGit(repoPath, ['config', 'user.name', 'T'])
  writeFileSync(path.join(repoPath, 'README.md'), 'hi')
  await execGit(repoPath, ['add', '.'])
  await execGit(repoPath, ['commit', '-m', 'init'])
}

const issue: ReviewerIssue = {
  title: 'x',
  severity: 'low',
  summary: '',
  whyItMatters: '',
  evidence: '',
  file: 'x.ts',
  lineStart: 1,
  lineEnd: 1,
  suggestedFix: '',
  confidence: 0.5,
}

const record: LedgerIssueRecord = {
  id: 'rec-1',
  issue,
  status: 'discovered',
  firstSeenRound: 1,
  latestSeenRound: 1,
  fixAttempts: 0,
  verifierDecision: null,
}

describe('ensureFixerChangesCommitted', () => {
  test('returns baseline sha when there are no changes', async () => {
    const repoRoot = makeTempDir('commit-attempt-')
    const config = createReviewLoopConfigFixture(repoRoot)
    const planPath = path.join(repoRoot, 'plan.md')
    writeFileSync(planPath, '# Plan')
    const runState = await createRunState(config, planPath)
    const ledger = await createIssueLedger(runState.runDir)
    await setupRepo(runState.worktreePath)
    const baselineSha = (await execGit(runState.worktreePath, ['rev-parse', 'HEAD'])).stdout.trim()

    const { pool, workers } = fakePool({ size: 1, worktreePaths: [runState.worktreePath] })
    const trace: TraceLogger = { append: () => Promise.resolve() }
    const deps: IssueProcessorDeps = {
      config,
      runState,
      ledger,
      spawn: () => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }),
      exec: () => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }),
      log: silentReporter(),
      trace,
      pool,
    }

    const postSha = await ensureFixerChangesCommitted(deps, workers[0]!, record, undefined)

    expect(postSha).toBe(baselineSha)
  })
})
