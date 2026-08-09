// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { realSpawn, splitLines } from '../../review-loop/src/spawn.js'

describe('splitLines', () => {
  const cases: ReadonlyArray<{
    name: string
    pending: string
    chunk: string
    lines: string[]
    remaining: string
  }> = [
    { name: 'single complete line', pending: '', chunk: '{"a":1}\n', lines: ['{"a":1}'], remaining: '' },
    {
      name: 'multiple lines in one chunk',
      pending: '',
      chunk: '{"a":1}\n{"b":2}\n',
      lines: ['{"a":1}', '{"b":2}'],
      remaining: '',
    },
    {
      name: 'line split across chunks: first half',
      pending: '',
      chunk: '{"a":',
      lines: [],
      remaining: '{"a":',
    },
    {
      name: 'line split across chunks: second half',
      pending: '{"a":',
      chunk: '1}\n',
      lines: ['{"a":1}'],
      remaining: '',
    },
    { name: 'skips empty lines', pending: '', chunk: '\n\n{"x":1}\n', lines: ['{"x":1}'], remaining: '' },
    {
      name: 'trailing partial without newline',
      pending: '',
      chunk: '{"a":1}\npartial',
      lines: ['{"a":1}'],
      remaining: 'partial',
    },
    { name: 'empty input', pending: '', chunk: '', lines: [], remaining: '' },
  ]

  for (const c of cases) {
    test(c.name, () => {
      expect(splitLines(c.pending, c.chunk)).toEqual({ lines: c.lines, remaining: c.remaining })
    })
  }
})

describe('realSpawn', () => {
  test('surfaces spawn error message when binary cannot be spawned', async () => {
    const result = await realSpawn('this-binary-does-not-exist-12345', [], { cwd: process.cwd() })
    expect(result.exitCode).toBe(1)
    expect(result.stderr.length).toBeGreaterThan(0)
    expect(result.stderr).toContain('this-binary-does-not-exist-12345')
  })

  test('kills a hanging subprocess after the configured timeout', async () => {
    const result = await realSpawn('sleep', ['5'], { cwd: process.cwd(), timeout: 500 })
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('timed out')
    expect(result.timedOut).toBe(true)
  })

  test('SIGKILLs a child that ignores SIGTERM after the grace period', async () => {
    const start = Date.now()
    const result = await realSpawn('sh', ['-c', "trap '' TERM; sleep 30"], {
      cwd: process.cwd(),
      timeout: 300,
      killGraceMs: 200,
    })
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('timed out')
    expect(Date.now() - start).toBeLessThan(5000)
  })

  test('completes normally when no timeout is configured', async () => {
    const result = await realSpawn('true', [], { cwd: process.cwd() })
    expect(result.exitCode).toBe(0)
    expect(result.timedOut).toBe(false)
  })

  test('kills a subprocess that stops producing output after inactivityTimeoutMs', async () => {
    const result = await realSpawn('sh', ['-c', 'echo started; sleep 30'], {
      cwd: process.cwd(),
      inactivityTimeoutMs: 300,
    })
    expect(result.exitCode).toBe(1)
    expect(result.stalled).toBe(true)
    expect(result.timedOut).toBe(true)
    expect(result.stderr).toContain('no output')
  })

  test('does not stall-kill a subprocess that keeps producing output', async () => {
    const result = await realSpawn(
      'sh',
      ['-c', 'i=0; while [ "$i" -lt 10 ]; do echo tick; sleep 0.05; i=$((i + 1)); done'],
      { cwd: process.cwd(), inactivityTimeoutMs: 1000 },
    )
    expect(result.exitCode).toBe(0)
    expect(result.stalled).toBeUndefined()
    expect(result.timedOut).toBe(false)
  })

  test('inactivity window restarts after each output chunk', async () => {
    // Quiet for less than the window, then speak again: must survive past the
    // original deadline and complete normally.
    const result = await realSpawn('sh', ['-c', 'sleep 0.2; echo late; sleep 0.2; echo later'], {
      cwd: process.cwd(),
      inactivityTimeoutMs: 400,
    })
    expect(result.exitCode).toBe(0)
    expect(result.stalled).toBeUndefined()
  })
})
