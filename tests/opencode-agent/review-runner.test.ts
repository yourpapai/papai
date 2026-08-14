// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { TranscriptRow } from '../../opencode-agent/src/activity-detail.js'
import type { LogFields, Logger } from '../../opencode-agent/src/logger.js'
import {
  buildReviewLoopConfig,
  describeFailure,
  REVIEW_STOPPED_EXIT_CODE,
  runReviewLoop,
} from '../../opencode-agent/src/review-runner.js'
import type { ReviewLoopSettings, ReviewRunResult } from '../../opencode-agent/src/review-runner.js'
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
  softStopMs: 60_000,
  commitAuthor: { name: 'agent[bot]', email: 'agent@example.invalid' },
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

  test("collects the loop's own trace, which is the review phase's tool activity", async () => {
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
      files: {
        listRuns: () => Promise.resolve(['2026-08-13T09-00-00-000Z-bbbb']),
        readText: () => Promise.resolve('{"event":"fix_complete"}\n'),
      },
      writeInputs: () => Promise.resolve({ planPath: '/tmp/plan.md', configPath: '/tmp/config.json' }),
    })

    // The phase opens no OpenCode session, so without this the artefact a
    // maintainer is told to read said nothing about the hour the loop spent.
    expect(rows.map((row) => row.tool)).toEqual(['review-loop', 'review-loop-trace'])
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

describe('buildReviewLoopConfig hand-over', () => {
  test('gives the loop the identity its commits are made under', () => {
    // Without it, `git commit` inside the loop's worktree fails outright on a
    // runner: "Author identity unknown". Run 31803380299 lost an accepted
    // high-severity fix that way, recorded as `needs_human` with git's advice
    // pasted into the reasoning.
    const config = buildReviewLoopConfig(
      settings({ commitAuthor: { name: 'opencode-agent[bot]', email: 'agent@users.noreply.github.com' } }),
    )

    expect(config['commitAuthor']).toEqual({
      name: 'opencode-agent[bot]',
      email: 'agent@users.noreply.github.com',
    })
  })

  test('hands over the soft budget, so the loop stops before the kill', () => {
    const config = buildReviewLoopConfig(settings({ softStopMs: 120_000 }))

    expect(config['runTimeoutMs']).toBe(120_000)
  })

  test('lets no single subprocess outlive the loop’s own budget', () => {
    // The stop is honoured between issues, so a fixer already running when it
    // fires is waited for. Bounding each agent by the run's remaining budget is
    // what keeps that wait from being longer than the run itself.
    const config = buildReviewLoopConfig(settings({ agentTimeoutMs: 90 * 60_000, softStopMs: 10 * 60_000 }))

    expect(config['agentTimeoutMs']).toBe(10 * 60_000)
    expect(config['fixer']).toMatchObject({ timeoutMs: 10 * 60_000 })
  })

  test('still publishes each fix as it lands', () => {
    // The other half of not losing work to a stop: a fix on the loop's own
    // branch dies with the runner's checkout.
    expect(buildReviewLoopConfig(settings())['mergeEachFix']).toBe(true)
  })
})

describe('runReviewLoop outcomes', () => {
  const runWith = (commandResult: CommandResult): Promise<ReviewRunResult> =>
    runReviewLoop({
      settings: settings(),
      plan: '- [ ] one',
      run: () => Promise.resolve(commandResult),
      env: {},
      log: recordingLogger().logger,
      timeoutMs: 1_000,
      writeInputs: () => Promise.resolve({ planPath: '/tmp/plan.md', configPath: '/tmp/config.json' }),
    })

  test('reads the loop’s own stop as `stopped`, which is neither passed nor failed', async () => {
    const review = await runWith(result({ exitCode: REVIEW_STOPPED_EXIT_CODE, stdout: '[review-loop] stopped: …' }))

    expect(review.outcome).toBe('stopped')
    // Not a failure: nothing broke, and what the loop had fixed is published.
    expect(review.failure).toBeNull()
  })

  test('still reads any other non-zero exit as a failure', async () => {
    const review = await runWith(result({ exitCode: 1, stderr: 'Final build check failed' }))

    expect(review.outcome).toBe('failed')
    expect(review.failure).not.toBeNull()
  })
})
