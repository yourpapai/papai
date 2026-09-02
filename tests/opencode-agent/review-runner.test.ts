// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { TranscriptRow } from '../../opencode-agent/src/activity-detail.js'
import { reviewLoopEnv } from '../../opencode-agent/src/deps.js'
import type { LogFields, Logger } from '../../opencode-agent/src/logger.js'
import { opencodeConfigEnv } from '../../opencode-agent/src/openai-config.js'
import {
  buildReviewLoopConfig,
  describeFailure,
  REVIEW_STOPPED_EXIT_CODE,
  runReviewLoop,
} from '../../opencode-agent/src/review-runner.js'
import type { ReviewLoopSettings, ReviewRunResult } from '../../opencode-agent/src/review-runner.js'
import type { CommandResult, CommandRunner, RunOptions } from '../../opencode-agent/src/shell.js'
import { STOPPED_EXIT_CODE } from '../../review-loop/src/cli.js'
import { ReviewLoopConfigSchema } from '../../review-loop/src/config.js'

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
  openai: { apiKey: 'k', baseUrl: 'https://example.invalid/v1', model: 'm', provider: 'openai' },
  checkCommand: 'bun check',
  maxRounds: 2,
  poolSize: 1,
  agentTimeoutMs: 1_000,
  softStopMs: 60_000,
  commitAuthor: { name: 'agent[bot]', email: 'agent@example.invalid' },
  backend: 'opencode',
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

/**
 * The pipe between the two workspaces, checked from the middle rather than from
 * each end.
 *
 * `buildReviewLoopConfig` writes a JSON file that another workspace's Zod schema
 * parses in another process, and `REVIEW_STOPPED_EXIT_CODE` is one number spelled
 * in two files. Every other contract of this kind here (`FIX_PUBLISHED_MARKER`)
 * has a test on each side and nothing in the middle, so a renamed field passes
 * both suites and fails only on a runner, an hour into a real review.
 */
describe('the config handed to review-loop', () => {
  test('is one the review-loop workspace actually accepts', () => {
    const parsed = ReviewLoopConfigSchema.parse(
      buildReviewLoopConfig(settings({ softStopMs: 120_000, commitAuthor: { name: 'a[bot]', email: 'a@b.invalid' } })),
    )

    expect(parsed.runTimeoutMs).toBe(120_000)
    expect(parsed.commitAuthor).toEqual({ name: 'a[bot]', email: 'a@b.invalid' })
    expect(parsed.mergeEachFix).toBe(true)
  })

  test('agrees with the loop on which exit code means "I stopped"', () => {
    expect(REVIEW_STOPPED_EXIT_CODE).toBe(STOPPED_EXIT_CODE)
  })
})

describe('buildReviewLoopConfig backend hand-off', () => {
  const ROLES = ['reviewer', 'fixer', 'matcher', 'inspector'] as const

  /** The generated agent block for one role, as a typed view. */
  const agentOf = (
    config: Record<string, unknown>,
    role: string,
  ): { model: string; backend?: unknown; extraArgs: unknown; effort: unknown } => {
    const block = config[role]
    if (typeof block !== 'object' || block === null || Array.isArray(block)) {
      throw new Error(`missing agent block: ${role}`)
    }
    const fields: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(block)) {
      fields[key] = value
    }
    if (typeof fields['model'] !== 'string') throw new Error(`missing model on ${role}`)
    return {
      model: fields['model'],
      backend: fields['backend'],
      extraArgs: fields['extraArgs'],
      effort: fields['effort'],
    }
  }

  test('the opencode route is unchanged: provider-prefixed model, no backend key', () => {
    const config = buildReviewLoopConfig(settings({ backend: 'opencode' }))

    for (const role of ROLES) {
      const agent = agentOf(config, role)
      expect(agent.model).toBe('openai/m')
      expect(agent.backend).toBeUndefined()
      expect(agent.extraArgs).toEqual([])
    }
  })

  test('the claude route stamps backend claude into every agent block with the plain model id', () => {
    const config = buildReviewLoopConfig(settings({ backend: 'claude' }))

    for (const role of ROLES) {
      const agent = agentOf(config, role)
      expect(agent.model).toBe('m')
      expect(agent.backend).toBe('claude')
      expect(agent.extraArgs).toEqual([])
    }
  })

  test('the claude route carries the resolved build tier into every agent block (D4)', () => {
    const config = buildReviewLoopConfig(
      settings({
        backend: 'claude',
        openai: {
          ...settings().openai,
          profiles: { light: null, planEffort: 'low', proposeEffort: null, buildEffort: 'xhigh' },
        },
      }),
    )

    for (const role of ROLES) {
      const agent = agentOf(config, role)
      // Every loop worker resolves to the primary `build` agent on the opencode
      // route, so the tier a worker would inherit there is `buildEffort` — the
      // claude route writes the same fact into the role config it spawns with.
      expect(agent.effort).toBe('xhigh')
    }
  })

  test('no tier resolves, no effort key — the loop-side schema refuses null', () => {
    const config = buildReviewLoopConfig(settings({ backend: 'claude' }))

    for (const role of ROLES) {
      const agent = agentOf(config, role)
      // Absent, never `null`: the loop's `AgentConfigSchema` types the tier as
      // an optional string, and a written null would refuse the whole config.
      expect(agent.effort).toBeUndefined()
    }
  })

  test('the opencode route never carries the tier — it rides OPENCODE_CONFIG_CONTENT', () => {
    const config = buildReviewLoopConfig(
      settings({
        backend: 'opencode',
        openai: {
          ...settings().openai,
          profiles: { light: null, planEffort: null, proposeEffort: null, buildEffort: 'xhigh' },
        },
      }),
    )

    for (const role of ROLES) {
      const agent = agentOf(config, role)
      expect(agent.effort).toBeUndefined()
    }
  })

  test('the claude-route config is one the review-loop workspace accepts', () => {
    expect(() => ReviewLoopConfigSchema.parse(buildReviewLoopConfig(settings({ backend: 'claude' })))).not.toThrow()
  })
})

describe('reviewLoopEnv (makeReviewRunner env branch)', () => {
  test('the claude route carries exactly the job credential, no OpenCode config content', () => {
    const env = reviewLoopEnv({
      backend: 'claude',
      claudeCredential: { name: 'ANTHROPIC_API_KEY', value: 'sk-ant-secret-0123456789' },
      openai: settings().openai,
    })

    expect(env).toEqual({ ANTHROPIC_API_KEY: 'sk-ant-secret-0123456789' })
    expect('OPENCODE_CONFIG_CONTENT' in env).toBe(false)
  })

  test('the oauth spelling rides under its own name', () => {
    const env = reviewLoopEnv({
      backend: 'claude',
      claudeCredential: { name: 'CLAUDE_CODE_OAUTH_TOKEN', value: 'oauth-token-0123456789' },
      openai: settings().openai,
    })

    expect(env).toEqual({ CLAUDE_CODE_OAUTH_TOKEN: 'oauth-token-0123456789' })
  })

  test('the opencode route is byte-identical to opencodeConfigEnv(config.openai)', () => {
    const openai = settings().openai
    expect(reviewLoopEnv({ backend: 'opencode', claudeCredential: null, openai })).toEqual(opencodeConfigEnv(openai))
  })
})
