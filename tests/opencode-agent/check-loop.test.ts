// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { formatFailures, runCheckLoop, truncateOutput } from '../../opencode-agent/src/check-loop.js'
import type { CheckSpec } from '../../opencode-agent/src/check-loop.js'
import type { CommandResult } from '../../opencode-agent/src/shell.js'

const CHECKS: CheckSpec[] = [
  { name: 'lint', argv: ['bun', 'run', 'lint'] },
  { name: 'test', argv: ['bun', 'test'] },
]

const result = (exitCode: number, stdout = '', stderr = ''): CommandResult => ({
  command: 'x',
  exitCode,
  stdout,
  stderr,
})

/**
 * Runner that fails until `state.fixed` flips. Defined outside the tests so the
 * branch does not live in a test body.
 */
const healingRunner =
  (state: { fixed: boolean }): (() => Promise<CommandResult>) =>
  () =>
    Promise.resolve(state.fixed ? result(0) : result(1, 'boom'))

describe('truncateOutput', () => {
  test('returns short output unchanged', () => {
    expect(truncateOutput(result(1, 'boom'), 100)).toBe('boom')
  })

  test('keeps the tail and reports how much was dropped', () => {
    const truncated = truncateOutput(result(1, 'a'.repeat(50) + 'TAIL'), 10)

    expect(truncated).toContain('TAIL')
    expect(truncated).toContain('truncated 44 chars')
    expect(truncated.endsWith('TAIL')).toBe(true)
  })

  test('merges stdout and stderr', () => {
    expect(truncateOutput(result(1, 'out', 'err'), 100)).toBe('out\nerr')
  })
})

describe('runCheckLoop', () => {
  test('passes on the first round when every check is green', async () => {
    const seen: string[] = []

    const outcome = await runCheckLoop({
      checks: CHECKS,
      run: (check) => {
        seen.push(check.name)
        return Promise.resolve(result(0))
      },
      repair: () => Promise.reject(new Error('repair must not run')),
      maxRounds: 3,
    })

    expect(outcome).toEqual({ passed: true, rounds: 1, failures: [] })
    expect(seen).toEqual(['lint', 'test'])
  })

  test('runs every check before repairing, so one prompt sees all failures', async () => {
    let repaired: string[] = []

    await runCheckLoop({
      checks: CHECKS,
      run: () => Promise.resolve(result(1, 'broken')),
      repair: (failures) => {
        repaired = failures.map((failure) => failure.name)
        return Promise.resolve()
      },
      maxRounds: 2,
    })

    expect(repaired).toEqual(['lint', 'test'])
  })

  test('repairs and retries until the checks go green', async () => {
    const state = { fixed: false }
    let repairs = 0

    const outcome = await runCheckLoop({
      checks: CHECKS,
      run: healingRunner(state),
      repair: (_failures, round) => {
        repairs = round
        state.fixed = true
        return Promise.resolve()
      },
      maxRounds: 3,
    })

    expect(outcome.passed).toBe(true)
    expect(outcome.rounds).toBe(2)
    expect(repairs).toBe(1)
  })

  test('gives up after maxRounds and reports the surviving failures', async () => {
    let repairs = 0

    const outcome = await runCheckLoop({
      checks: [CHECKS[0]!],
      run: () => Promise.resolve(result(2, 'still broken')),
      repair: () => {
        repairs += 1
        return Promise.resolve()
      },
      maxRounds: 3,
    })

    expect(outcome.passed).toBe(false)
    expect(outcome.rounds).toBe(3)
    expect(repairs).toBe(2)
    expect(outcome.failures).toEqual([{ name: 'lint', exitCode: 2, output: 'still broken' }])
  })

  test('maxRounds of 1 disables self-repair', async () => {
    let repairs = 0

    const outcome = await runCheckLoop({
      checks: [CHECKS[0]!],
      run: () => Promise.resolve(result(1)),
      repair: () => {
        repairs += 1
        return Promise.resolve()
      },
      maxRounds: 1,
    })

    expect(repairs).toBe(0)
    expect(outcome.rounds).toBe(1)
  })

  test('clamps a nonsensical maxRounds up to one attempt', async () => {
    const outcome = await runCheckLoop({
      checks: [CHECKS[0]!],
      run: () => Promise.resolve(result(0)),
      repair: () => Promise.reject(new Error('repair must not run')),
      maxRounds: 0,
    })

    expect(outcome).toEqual({ passed: true, rounds: 1, failures: [] })
  })

  test('an empty check list passes trivially', async () => {
    const outcome = await runCheckLoop({
      checks: [],
      run: () => Promise.reject(new Error('run must not be called')),
      repair: () => Promise.reject(new Error('repair must not run')),
      maxRounds: 2,
    })

    expect(outcome.passed).toBe(true)
  })
})

describe('formatFailures', () => {
  test('renders each failure as a fenced block', () => {
    const rendered = formatFailures([{ name: 'lint', exitCode: 2, output: 'bad code' }])

    expect(rendered).toContain('**lint** (exit 2)')
    expect(rendered).toContain('```\nbad code\n```')
  })

  test('caps each block at the per-failure budget', () => {
    const rendered = formatFailures([{ name: 'test', exitCode: 1, output: 'x'.repeat(100) }], 10)

    expect(rendered).toContain('x'.repeat(10))
    expect(rendered).not.toContain('x'.repeat(11))
  })

  test('renders nothing for an empty failure list', () => {
    expect(formatFailures([])).toBe('')
  })
})
