// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { ALLOWED_PREFIXES, classifyDiff, runDiffGuard } from '../../mutation-improve/src/diff-guard.js'

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
      expect(args).toEqual(['diff', '--name-only', 'HEAD'])
      return Promise.resolve({ stdout: 'tests/a.test.ts\ndocs/superpowers/plans/p.md\n', stderr: '' })
    }
    const result = await runDiffGuard(execGit, '/repo/wt')
    expect(result).toEqual({ ok: true })
  })

  test('runDiffGuard returns violations when src/ or baseline.json changed', async () => {
    const execGit = (): Promise<GitResult> => Promise.resolve({ stdout: 'tests/a.test.ts\nsrc/foo.ts\n', stderr: '' })
    const result = await runDiffGuard(execGit, '/repo/wt')
    expect(result).toEqual({ ok: false, violations: ['src/foo.ts'] })
  })
})
