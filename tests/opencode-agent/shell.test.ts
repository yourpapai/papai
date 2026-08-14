// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { runCommand } from '../../opencode-agent/src/shell.js'

/**
 * The child-process boundary. Two properties matter here and neither is
 * observable from the buffered result the runner used to hand back: that a long
 * command's output reaches the caller *while it runs*, and that a command killed
 * by its own deadline says so rather than looking like an ordinary non-zero exit.
 */
describe('runCommand', () => {
  test('streams stdout line by line while the child is still running', async () => {
    const lines: Array<{ line: string; stream: string }> = []

    const result = await runCommand(['bash', '-c', 'echo one; echo two; echo three'], {
      cwd: process.cwd(),
      onOutput: (line, stream): void => {
        lines.push({ line, stream })
      },
    })

    expect(lines).toEqual([
      { line: 'one', stream: 'stdout' },
      { line: 'two', stream: 'stdout' },
      { line: 'three', stream: 'stdout' },
    ])
    // The buffered form still holds everything: the stream is an addition, not a
    // replacement — `extractSummary` and every check runner still read it.
    expect(result.stdout).toBe('one\ntwo\nthree\n')
    expect(result.exitCode).toBe(0)
  })

  test('reports stderr on its own stream', async () => {
    const lines: Array<{ line: string; stream: string }> = []

    await runCommand(['bash', '-c', 'echo out; echo err 1>&2'], {
      cwd: process.cwd(),
      onOutput: (line, stream): void => {
        lines.push({ line, stream })
      },
    })

    expect(lines).toContainEqual({ line: 'out', stream: 'stdout' })
    expect(lines).toContainEqual({ line: 'err', stream: 'stderr' })
  })

  test('flushes a trailing line the child never terminated', async () => {
    const lines: string[] = []

    await runCommand(['bash', '-c', 'printf no-newline'], {
      cwd: process.cwd(),
      onOutput: (line): void => {
        lines.push(line)
      },
    })

    expect(lines).toEqual(['no-newline'])
  })

  test('marks a command its own deadline killed', async () => {
    const result = await runCommand(['bash', '-c', 'sleep 5'], { cwd: process.cwd(), timeoutMs: 50 })

    expect(result.timedOut).toBe(true)
    expect(result.exitCode).not.toBe(0)
  })

  test('kills with the signal the caller asked for, so a handler cannot absorb it', async () => {
    // The review loop installs a SIGTERM handler and treats it as "finish the fix
    // in hand and stop" — right for a Ctrl-C, and wrong for the deadline behind
    // its own soft stop, where finishing one more fixer would outlive the runner.
    const result = await runCommand(['bash', '-c', 'trap "" TERM; sleep 5'], {
      cwd: process.cwd(),
      timeoutMs: 100,
      killSignal: 'SIGKILL',
    })

    expect(result.timedOut).toBe(true)
  }, 10_000)

  test('leaves timedOut false for a command that exited on its own', async () => {
    const result = await runCommand(['bash', '-c', 'exit 3'], { cwd: process.cwd(), timeoutMs: 60_000 })

    expect(result.timedOut).toBe(false)
    expect(result.exitCode).toBe(3)
  })
})
