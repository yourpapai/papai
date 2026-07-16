// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { runBuildCheck, type ShellExecFn } from '../../review-loop/src/build-checker.js'

function createMockExec(results: Array<{ exitCode: number; stdout: string; stderr: string }>): ShellExecFn {
  let index = 0
  return () => {
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
})
