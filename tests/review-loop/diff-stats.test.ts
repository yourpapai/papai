// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { headSha, measureDiffSince, parseNumstat, type ExecGitFn } from '../../review-loop/src/diff-stats.js'

describe('parseNumstat', () => {
  test('sums added/removed across files', () => {
    expect(parseNumstat('10\t2\tsrc/a.ts\n3\t0\tsrc/b.ts\n')).toEqual({ added: 13, removed: 2 })
  })

  test('binary lines (-) count as zero', () => {
    expect(parseNumstat('-\t-\timg.png\n5\t1\tsrc/a.ts\n')).toEqual({ added: 5, removed: 1 })
  })

  test('rename lines parse', () => {
    expect(parseNumstat('4\t2\tsrc/{old.ts => new.ts}\n')).toEqual({ added: 4, removed: 2 })
  })

  test('empty output is zero', () => {
    expect(parseNumstat('')).toEqual({ added: 0, removed: 0 })
  })
})

describe('headSha / measureDiffSince', () => {
  test('headSha trims rev-parse output', async () => {
    const execGit: ExecGitFn = (_cwd, args) => {
      expect(args).toEqual(['rev-parse', 'HEAD'])
      return Promise.resolve({ stdout: '  abc123\n', stderr: '' })
    }
    await expect(headSha(execGit, '/repo')).resolves.toBe('abc123')
  })

  test('measureDiffSince runs numstat against beforeSha..HEAD', async () => {
    const execGit: ExecGitFn = (_cwd, args) => {
      expect(args).toEqual(['diff', '--numstat', 'abc123..HEAD'])
      return Promise.resolve({ stdout: '7\t3\tsrc/a.ts\n', stderr: '' })
    }
    await expect(measureDiffSince(execGit, '/repo', 'abc123')).resolves.toEqual({ added: 7, removed: 3 })
  })
})
