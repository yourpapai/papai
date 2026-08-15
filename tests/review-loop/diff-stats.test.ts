// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { isTestFile } from '../../.hooks/tdd/test-resolver.mjs'
import {
  headSha,
  measureDiffPathsSince,
  measureDiffSince,
  parseNumstat,
  parseNumstatPaths,
  touchedTestPath,
  type ExecGitFn,
} from '../../review-loop/src/diff-stats.js'

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

describe('parseNumstatPaths', () => {
  test('returns the changed paths', () => {
    expect(parseNumstatPaths('10\t2\tsrc/a.ts\n3\t0\tsrc/b.ts\n')).toEqual(['src/a.ts', 'src/b.ts'])
  })

  test('a binary file still counts as touched even though its line counts do not', () => {
    expect(parseNumstatPaths('-\t-\timg.png\n5\t1\tsrc/a.ts\n')).toEqual(['img.png', 'src/a.ts'])
  })

  test('a rename resolves to the destination, not the brace form', () => {
    expect(parseNumstatPaths('4\t2\tsrc/{old.ts => new.ts}\n')).toEqual(['src/new.ts'])
    expect(parseNumstatPaths('1\t1\t{a => b}/c.ts\n')).toEqual(['b/c.ts'])
    expect(parseNumstatPaths('1\t1\told.ts => new.ts\n')).toEqual(['new.ts'])
  })

  test('empty output yields no paths', () => {
    expect(parseNumstatPaths('')).toEqual([])
    expect(parseNumstatPaths('\n\n')).toEqual([])
  })

  test('parseNumstat keeps its counts-only shape: mutation-improve imports it', () => {
    expect(parseNumstat('10\t2\tsrc/a.ts\n')).toEqual({ added: 10, removed: 2 })
  })
})

describe('measureDiffPathsSince', () => {
  test('asks git for the same numstat and returns the paths', async () => {
    const calls: string[][] = []
    const execGit: ExecGitFn = (_cwd, args) => {
      calls.push([...args])
      return Promise.resolve({ stdout: '1\t0\tsrc/a.ts\n0\t1\ttests/a.test.ts\n', stderr: '' })
    }
    expect(await measureDiffPathsSince(execGit, '/repo', 'abc')).toEqual(['src/a.ts', 'tests/a.test.ts'])
    expect(calls[0]).toEqual(['diff', '--numstat', 'abc..HEAD'])
  })
})

describe('touchedTestPath', () => {
  test('true when a test file was touched', () => {
    expect(touchedTestPath(['review-loop/src/a.ts', 'tests/review-loop/a.test.ts'])).toBe(true)
  })

  test('false when only implementation was touched', () => {
    expect(touchedTestPath(['review-loop/src/a.ts', 'docs/architecture/x.md'])).toBe(false)
  })

  test('false for no paths at all', () => {
    expect(touchedTestPath([])).toBe(false)
  })

  test('agrees with the repo TDD resolver rather than inventing a second rule', () => {
    const cases = [
      'tests/review-loop/a.test.ts',
      'tests/a.spec.tsx',
      'src/a.ts',
      'review-loop/src/a.ts',
      'a.test.js',
      'notatest.ts',
    ]
    for (const p of cases) {
      expect(touchedTestPath([p])).toBe(isTestFile(p))
    }
  })
})
