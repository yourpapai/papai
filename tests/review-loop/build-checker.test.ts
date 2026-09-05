// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createShellExec, runBuildCheck, type ShellExecFn } from '../../review-loop/src/build-checker.js'

function createMockExec(results: Array<{ exitCode: number; stdout: string; stderr: string }>): ShellExecFn {
  let index = 0
  return (_cwd?: string) => {
    const result = results[index] ?? results[results.length - 1]!
    index += 1
    return Promise.resolve(result)
  }
}

describe('build-checker', () => {
  test('returns passed=true when exit code is 0', async () => {
    const exec = createMockExec([{ exitCode: 0, stdout: 'all good', stderr: '' }])
    const result = await runBuildCheck({ exec })
    expect(result.passed).toBe(true)
  })

  test('returns passed=false with stderr when exit code is non-zero', async () => {
    const exec = createMockExec([{ exitCode: 1, stdout: '', stderr: 'TypeError: x is not a function' }])
    const result = await runBuildCheck({ exec })
    expect(result.passed).toBe(false)
    expect(result.stderr).toContain('TypeError')
  })

  test('times out a hanging build command and reports the timeout', async () => {
    const exec = createShellExec(process.cwd(), 'sleep 5', 500)
    const result = await exec()
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('timed out')
  })

  test('completes normally when no timeout is configured', async () => {
    const exec = createShellExec(process.cwd(), 'true')
    const result = await exec()
    expect(result.exitCode).toBe(0)
  })

  test('separates the two streams', async () => {
    const exec = createShellExec(process.cwd(), 'echo to-stdout; echo to-stderr >&2; exit 3')
    const result = await exec()
    expect(result.exitCode).toBe(3)
    expect(result.stdout.trim()).toBe('to-stdout')
    expect(result.stderr.trim()).toBe('to-stderr')
  })

  // The check command is `bun check:full`, whose failure path `cat`s a whole
  // multi-thousand-line check log to stdout. Captured through a pipe that carries
  // O_NONBLOCK, that `cat` dies on EAGAIN and `set -e` takes the verdict with it
  // (run 33974052563); the old 10 MB `maxBuffer` silently truncated it in the
  // other direction. Files have neither failure mode, so a big writer arrives
  // whole and the child's own exit code is what comes back.
  test('a child writing well past the retired 10MB maxBuffer arrives whole', async () => {
    const emit = `awk 'BEGIN { s = sprintf("%*s", 200, ""); gsub(/ /, "x", s); for (i = 0; i < 60000; i++) print s; print "TAIL-MARKER" }'`
    const exec = createShellExec(process.cwd(), `${emit}; exit 7`)

    const result = await exec()

    expect(result.exitCode).toBe(7)
    expect(result.stdout.length).toBeGreaterThan(10 * 1024 * 1024)
    expect(result.stdout.trimEnd().endsWith('TAIL-MARKER')).toBe(true)
  })
})

describe('build-checker credential scrub', () => {
  const SECRET = 'sk-ant-secret-0123456789'

  test('the single BuildCheckResult producer scrubs stdout and stderr once', async () => {
    const exec = createMockExec([
      { exitCode: 1, stdout: `echo ran with ${SECRET}`, stderr: `error: env ${SECRET} rejected` },
    ])
    const result = await runBuildCheck({ exec, credentialValue: SECRET })
    expect(result.stdout).toContain('[redacted]')
    expect(result.stdout).not.toContain(SECRET)
    expect(result.stderr).toContain('[redacted]')
    expect(result.stderr).not.toContain(SECRET)
  })

  test('the scrub is absent on the opencode route (no credentialValue field)', async () => {
    const exec = createMockExec([{ exitCode: 0, stdout: `says ${SECRET}`, stderr: '' }])
    const result = await runBuildCheck({ exec })
    expect(result.stdout).toContain(SECRET)
  })

  test('a sub-floor credential value is not scrubbed', async () => {
    const short = 'short-token'
    const exec = createMockExec([{ exitCode: 0, stdout: `says ${short}`, stderr: '' }])
    const result = await runBuildCheck({ exec, credentialValue: short })
    expect(result.stdout).toContain(short)
  })
})
