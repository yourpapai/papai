// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { TranscriptRow } from '../../opencode-agent/src/activity-detail.js'
import type { LogFields, Logger } from '../../opencode-agent/src/logger.js'
import { buildReviewLoopConfig, describeFailure, runReviewLoop } from '../../opencode-agent/src/review-runner.js'
import type { ReviewLoopSettings } from '../../opencode-agent/src/review-runner.js'
import type { CommandResult, CommandRunner, RunOptions } from '../../opencode-agent/src/shell.js'

/** A logger that keeps what it was told, so "it reached the CI log" is assertable. */
const recordingLogger = (): { logger: Logger; lines: Array<{ message: string; fields: LogFields }> } => {
  const lines: Array<{ message: string; fields: LogFields }> = []
  const record =
    (): ((fields: LogFields, message: string) => void) =>
    (fields, message): void => {
      lines.push({ message, fields })
    }
  return { logger: { debug: record(), info: record(), warn: record(), error: record() }, lines }
}

const settings = (overrides: Partial<ReviewLoopSettings> = {}): ReviewLoopSettings => ({
  repoRoot: '/tmp/does-not-need-to-exist',
  command: ['bun', 'run', 'review-loop/src/cli.ts'],
  openai: { apiKey: 'k', baseUrl: 'https://example.invalid/v1', model: 'm' },
  checkCommand: 'bun check',
  maxRounds: 2,
  poolSize: 1,
  agentTimeoutMs: 1_000,
  ...overrides,
})

const result = (overrides: Partial<CommandResult> = {}): CommandResult => ({
  command: 'review-loop',
  exitCode: 0,
  stdout: '',
  stderr: '',
  timedOut: false,
  ...overrides,
})

/** A runner that replays lines through `onOutput` the way a real child would. */
const replaying = (lines: readonly string[], exitCode = 0): CommandRunner => {
  return (_argv: readonly string[], options: RunOptions): Promise<CommandResult> => {
    for (const line of lines) options.onOutput?.(line, 'stdout')
    return Promise.resolve(result({ stdout: `${lines.join('\n')}\n`, exitCode }))
  }
}

describe('runReviewLoop output', () => {
  test('reports every line of the loop in the public log as it arrives', async () => {
    const log = recordingLogger()

    await runReviewLoop({
      settings: settings(),
      plan: '- [ ] one',
      run: replaying(['[round 1/2] Reviewing...', '[round 1] Fixed 1/1 issues']),
      env: {},
      log: log.logger,
      timeoutMs: 1_000,
      writeInputs: () => Promise.resolve({ planPath: '/tmp/plan.md', configPath: '/tmp/config.json' }),
    })

    const messages = log.lines.map((line) => line.message)
    expect(messages).toContain('[round 1/2] Reviewing...')
    expect(messages).toContain('[round 1] Fixed 1/1 issues')
  })

  test('feeds the same lines to the encrypted transcript', async () => {
    const rows: TranscriptRow[] = []

    await runReviewLoop({
      settings: settings(),
      plan: '- [ ] one',
      run: replaying(['[round 1/2] Reviewing...']),
      env: {},
      log: recordingLogger().logger,
      timeoutMs: 1_000,
      transcript: {
        write: (row): void => {
          rows.push(row)
        },
      },
      writeInputs: () => Promise.resolve({ planPath: '/tmp/plan.md', configPath: '/tmp/config.json' }),
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]?.tool).toBe('review-loop')
    expect(rows[0]?.detail).toBe('[round 1/2] Reviewing...')
  })

  test('calls back when the loop says a fix landed on the branch', async () => {
    let merged = 0

    await runReviewLoop({
      settings: settings(),
      plan: '- [ ] one',
      run: replaying([
        '[review-loop] published fix to review-loop/run-1',
        'noise',
        '[review-loop] published fix again',
      ]),
      env: {},
      log: recordingLogger().logger,
      timeoutMs: 1_000,
      onFixMerged: () => {
        merged += 1
      },
      writeInputs: () => Promise.resolve({ planPath: '/tmp/plan.md', configPath: '/tmp/config.json' }),
    })

    expect(merged).toBe(2)
  })

  test('an unconfigured repository is unavailable, not failed', async () => {
    const review = await runReviewLoop({
      settings: settings({ command: null }),
      plan: '',
      run: replaying([]),
      env: {},
      log: recordingLogger().logger,
      timeoutMs: 1_000,
      writeInputs: () => Promise.resolve({ planPath: '/tmp/plan.md', configPath: '/tmp/config.json' }),
    })

    expect(review.outcome).toBe('unavailable')
    expect(review.failure).toBeNull()
  })
})

describe('describeFailure', () => {
  test('says nothing about a loop that passed', () => {
    expect(describeFailure(result({ exitCode: 0 }), 60_000)).toBeNull()
  })

  test('names the deadline that killed the loop', () => {
    const failure = describeFailure(result({ exitCode: 1, timedOut: true }), 90 * 60_000)

    expect(failure).toContain('90m')
    expect(failure).toContain('timed out')
  })

  test('names a command that could not be started', () => {
    const failure = describeFailure(result({ exitCode: 127, stderr: 'spawn bun ENOENT' }), 60_000)

    expect(failure).toContain('could not be started')
    expect(failure).toContain('spawn bun ENOENT')
  })

  test("names the loop's own build gate, which is the failure that keeps findings unmerged", () => {
    const stdout = 'Final build check failed; worktree preserved at /x for inspection, merge skipped.'
    const failure = describeFailure(result({ exitCode: 1, stdout }), 60_000)

    expect(failure).toContain('build gate')
  })

  test('names a merge conflict', () => {
    const stderr = 'Merge conflict while bringing review-loop/run-1 into HEAD; the merge was aborted.'
    const failure = describeFailure(result({ exitCode: 1, stderr }), 60_000)

    expect(failure).toContain('conflict')
  })

  test('falls back to the exit code and the last thing the loop said', () => {
    const failure = describeFailure(result({ exitCode: 2, stderr: 'Plan file not found: /x/tasks.md' }), 60_000)

    expect(failure).toContain('exited 2')
    expect(failure).toContain('Plan file not found: /x/tasks.md')
  })
})

describe('buildReviewLoopConfig', () => {
  test('asks the loop to publish each fix, so a run that dies later keeps them', () => {
    expect(buildReviewLoopConfig(settings())['mergeEachFix']).toBe(true)
  })
})
