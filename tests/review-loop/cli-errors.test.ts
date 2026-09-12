// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { BuildCheckResult } from '../../review-loop/src/build-checker.js'
import {
  formatBuildFailureMessage,
  formatMergeConflictMessage,
  MergeConflictError,
} from '../../review-loop/src/cli-errors.js'
import type { RunState } from '../../review-loop/src/run-state.js'

function makeRunState(): RunState {
  return {
    runId: 'test-run',
    repoRoot: '/repo',
    planPath: '/repo/plan.md',
    currentRound: 0,
    noProgressRounds: 0,
    runDir: '/repo/.review-loop/runs/test-run',
    worktreePath: '/repo/.review-loop/worktrees/test-run',
    ledgerPath: '/repo/.review-loop/runs/test-run/ledger.json',
    issuesPath: '/repo/.review-loop/runs/test-run/issues.json',
    resultPath: '/repo/.review-loop/runs/test-run/result.json',
    matchesPath: '/repo/.review-loop/runs/test-run/matches.json',
    logPath: '/repo/.review-loop/runs/test-run/agent-output.log',
    tracePath: '/repo/.review-loop/runs/test-run/trace.jsonl',
    statePath: '/repo/.review-loop/runs/test-run/state.json',
  }
}

describe('formatBuildFailureMessage', () => {
  test('includes worktree path, log path, and tail of build output', () => {
    const runState = makeRunState()
    const build: BuildCheckResult = {
      passed: false,
      stdout: 'line-one\nline-two\n',
      stderr: 'stderr-detail\n',
    }

    const message = formatBuildFailureMessage(runState, build)

    expect(message).toContain('/repo/.review-loop/worktrees/test-run')
    expect(message).toContain('/repo/.review-loop/runs/test-run/build-check.log')
    expect(message).toContain('line-two')
    expect(message).toContain('stderr-detail')
  })

  test('truncates long build output to the tail', () => {
    const runState = makeRunState()
    const firstLine = 'FIRST-LINE-MUST-BE-TRUNCATED'
    const lastLine = 'last-line-kept'
    const stdout = [firstLine, ...Array.from({ length: 60 }, (_, i) => `line-${i}`), lastLine].join('\n')
    const build: BuildCheckResult = { passed: false, stdout, stderr: '' }

    const message = formatBuildFailureMessage(runState, build)

    expect(message).toContain(lastLine)
    expect(message).toContain('truncated')
    expect(message).not.toContain(firstLine)
  })

  // Run 33974052563: `bun build:client` wrote ~170 vite warnings to stderr while
  // check.sh wrote its verdict to stdout. Tailing the concatenation put the whole
  // window inside stderr and reported nothing about which check failed.
  test('a noisy stderr cannot evict the stdout verdict from the tail', () => {
    const runState = makeRunState()
    const verdict = '2/8 checks passed, 6 failed'
    const build: BuildCheckResult = {
      passed: false,
      stdout: [...Array.from({ length: 200 }, (_, i) => `stdout-noise-${i}`), verdict].join('\n'),
      stderr: Array.from({ length: 200 }, (_, i) => `vite warning ${i}`).join('\n'),
    }

    const message = formatBuildFailureMessage(runState, build)

    expect(message).toContain(verdict)
    expect(message).toContain('vite warning 199')
  })

  test('labels each stream so the reader knows which one they are looking at', () => {
    const runState = makeRunState()
    const build: BuildCheckResult = { passed: false, stdout: 'out-line', stderr: 'err-line' }

    const message = formatBuildFailureMessage(runState, build)

    expect(message).toContain('--- stdout ---')
    expect(message).toContain('--- stderr ---')
    expect(message.indexOf('out-line')).toBeLessThan(message.indexOf('err-line'))
  })

  test('says so when the build command produced no output at all', () => {
    const message = formatBuildFailureMessage(makeRunState(), { passed: false, stdout: '', stderr: '' })

    expect(message).toContain('produced no output')
  })
})

describe('MergeConflictError', () => {
  test('message includes branch name, conflict files, recovery commands, runDir, and worktree', () => {
    const runState = makeRunState()
    const branch = 'review-loop/test-run'
    const files = ['tests/a.test.ts', 'src/b.ts']

    const error = new MergeConflictError(branch, files, runState)

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('MergeConflictError')
    expect(error.branchName).toBe(branch)
    expect(error.conflictFiles).toEqual(files)
    const msg = error.message
    expect(msg).toContain(branch)
    expect(msg).toContain('tests/a.test.ts')
    expect(msg).toContain('src/b.ts')
    expect(msg).toContain('Conflicted files (2)')
    expect(msg).toContain('git merge review-loop/test-run')
    expect(msg).toContain('git rebase review-loop/test-run')
    expect(msg).toContain(runState.runDir)
    expect(msg).toContain(runState.worktreePath)
    expect(msg).toContain('merge was aborted')
  })

  test('handles zero-file conflict (defensive)', () => {
    const runState = makeRunState()
    const error = new MergeConflictError('review-loop/x', [], runState)
    expect(error.message).toContain('listed no files')
  })
})

describe('formatMergeConflictMessage', () => {
  test('produces same text as MergeConflictError', () => {
    const runState = makeRunState()
    const branch = 'review-loop/y'
    const files = ['c.ts']
    expect(formatMergeConflictMessage(branch, files, runState)).toBe(
      new MergeConflictError(branch, files, runState).message,
    )
  })
})
