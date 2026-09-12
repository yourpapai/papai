// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * About twenty suites shell out to `git init` without `-b`. Git 2.28+ answers each one
 * with a ten-line advice block on stderr — roughly a hundred lines, a fifth of everything
 * a near-green full-suite run prints, and nothing a console mock can reach.
 *
 * The fix still lives in `scripts/test/run.ts` (it is explicit and order-independent),
 * but for a different reason than it used to. Through bun 1.3, runtime `process.env`
 * mutations did not reach subprocesses the way they do in Node, so a preload assignment
 * was invisible to every git child; bun 1.4 fixed that (pinned by the first test below).
 */

const REPO_ROOT = path.resolve(import.meta.dir, '..')
const GITCONFIG = path.join(REPO_ROOT, 'tests/fixtures/gitconfig')

const tempDirs: string[] = []

const makeRepoDir = (): string => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'git-init-hint-'))
  tempDirs.push(dir)
  return dir
}

const pinnedEnv = (): NodeJS.ProcessEnv => ({
  ...process.env,
  GIT_CONFIG_GLOBAL: GITCONFIG,
  GIT_CONFIG_SYSTEM: '/dev/null',
})

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('git advice suppression', () => {
  test('the fixture exists, because the wrapper points every run at it', () => {
    expect(existsSync(GITCONFIG)).toBe(true)
  })

  test('git init under the pinned config prints no advice', () => {
    const dir = makeRepoDir()

    const result = spawnSync('git', ['init'], { cwd: dir, encoding: 'utf8', env: pinnedEnv() })

    expect(result.status).toBe(0)
    expect(result.stderr).not.toContain('hint:')
    expect(result.stdout).not.toContain('hint:')
  })

  test('the pinned default branch stays master, so branch-name assertions hold', () => {
    const dir = makeRepoDir()

    spawnSync('git', ['init', '-q'], { cwd: dir, encoding: 'utf8', env: pinnedEnv() })
    const head = spawnSync('git', ['symbolic-ref', 'HEAD'], { cwd: dir, encoding: 'utf8', env: pinnedEnv() })

    expect(head.stdout.trim()).toBe('refs/heads/master')
  })

  test('bun propagates a runtime env assignment to a child process (fixed in 1.4)', () => {
    // Through bun 1.3 a var assigned at runtime was invisible to child processes,
    // which forced the git config pin onto the child's startup environment. Bun 1.4
    // aligns with Node here; pin the fix so a regression cannot silently strand the
    // ~20 git-shelling suites again.
    process.env['PAPAI_ENV_PROPAGATION_PROBE'] = 'set-at-runtime'
    try {
      const seen = spawnSync('sh', ['-c', 'printf %s "$PAPAI_ENV_PROPAGATION_PROBE"'], { encoding: 'utf8' })

      expect(seen.stdout).toBe('set-at-runtime')
    } finally {
      delete process.env['PAPAI_ENV_PROPAGATION_PROBE']
    }
  })
})
