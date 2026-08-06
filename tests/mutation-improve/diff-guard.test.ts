// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  ALLOWED_PREFIXES,
  classifyDiff,
  parsePorcelainPaths,
  runDiffGuard,
} from '../../mutation-improve/src/diff-guard.js'

type GitResult = { stdout: string; stderr: string }

describe('diff-guard', () => {
  test('ALLOWED_PREFIXES is tests/ and docs/superpowers/', () => {
    expect(ALLOWED_PREFIXES).toEqual(['tests/', 'docs/superpowers/'])
  })

  test('classifyDiff splits allowed from violations', () => {
    const result = classifyDiff([
      'tests/live-status/x.test.ts',
      'docs/superpowers/specs/x-design.md',
      'src/foo.ts',
      'scripts/mutation/baseline.json',
    ])
    expect(result.allowed).toEqual(['tests/live-status/x.test.ts', 'docs/superpowers/specs/x-design.md'])
    expect(result.violations).toEqual(['src/foo.ts', 'scripts/mutation/baseline.json'])
  })

  test('runDiffGuard returns ok when all changed paths are allowed', async () => {
    const execGit = (_cwd: string, args: readonly string[]): Promise<GitResult> => {
      expect(args).toEqual(['status', '--porcelain', '--untracked-files=all'])
      return Promise.resolve({ stdout: ' M tests/a.test.ts\n?? docs/superpowers/plans/p.md\n', stderr: '' })
    }
    const result = await runDiffGuard(execGit, '/repo/wt')
    expect(result).toEqual({ ok: true })
  })

  test('runDiffGuard returns violations when src/ or baseline.json changed', async () => {
    const execGit = (): Promise<GitResult> =>
      Promise.resolve({ stdout: ' M tests/a.test.ts\n M src/foo.ts\n', stderr: '' })
    const result = await runDiffGuard(execGit, '/repo/wt')
    expect(result).toEqual({ ok: false, violations: ['src/foo.ts'] })
  })

  test('runDiffGuard catches an UNTRACKED forbidden file (?? in porcelain)', async () => {
    // F1 regression guard: `git diff --name-only HEAD` is blind to untracked
    // files, so a misbehaving agent's untracked src/evil.ts bypassed the guard,
    // got staged by `git add -A`, and merged to base. porcelain surfaces `??`.
    const execGit = (): Promise<GitResult> => Promise.resolve({ stdout: '?? src/new.ts\n', stderr: '' })
    const result = await runDiffGuard(execGit, '/repo/wt')
    expect(result).toEqual({ ok: false, violations: ['src/new.ts'] })
  })

  test('runDiffGuard strips porcelain quotes around paths with special chars', async () => {
    const execGit = (): Promise<GitResult> => Promise.resolve({ stdout: ' M "tests/a b.test.ts"\n', stderr: '' })
    const result = await runDiffGuard(execGit, '/repo/wt')
    expect(result).toEqual({ ok: true })
  })

  test('parsePorcelainPaths returns a single path for non-rename entries', () => {
    expect(parsePorcelainPaths(' M tests/a.test.ts')).toEqual(['tests/a.test.ts'])
    expect(parsePorcelainPaths('?? "docs/superpowers/a b.md"')).toEqual(['docs/superpowers/a b.md'])
  })

  test('parsePorcelainPaths splits rename entries into both endpoints', () => {
    expect(parsePorcelainPaths('R  tests/old.test.ts -> tests/new.test.ts')).toEqual([
      'tests/old.test.ts',
      'tests/new.test.ts',
    ])
    expect(parsePorcelainPaths('R  "tests/a b.test.ts" -> "tests/c d.test.ts"')).toEqual([
      'tests/a b.test.ts',
      'tests/c d.test.ts',
    ])
  })

  test('runDiffGuard flags a rename from allowed to forbidden (smuggle)', async () => {
    const execGit = (): Promise<GitResult> =>
      Promise.resolve({ stdout: 'R  tests/a.test.ts -> src/foo.ts\n', stderr: '' })
    const result = await runDiffGuard(execGit, '/repo/wt')
    expect(result).toEqual({ ok: false, violations: ['src/foo.ts'] })
  })

  test('runDiffGuard flags a rename from forbidden to allowed (source removal)', async () => {
    const execGit = (): Promise<GitResult> =>
      Promise.resolve({ stdout: 'R  src/foo.ts -> tests/foo.test.ts\n', stderr: '' })
    const result = await runDiffGuard(execGit, '/repo/wt')
    expect(result).toEqual({ ok: false, violations: ['src/foo.ts'] })
  })

  test('runDiffGuard allows a rename within tests/', async () => {
    const execGit = (): Promise<GitResult> =>
      Promise.resolve({ stdout: 'R  tests/old.test.ts -> tests/new.test.ts\n', stderr: '' })
    const result = await runDiffGuard(execGit, '/repo/wt')
    expect(result).toEqual({ ok: true })
  })
})
