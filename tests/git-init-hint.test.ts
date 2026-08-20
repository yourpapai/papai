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
 * The fix cannot live in `tests/setup.ts`. Bun does not propagate later `process.env`
 * mutations to subprocesses the way Node does, so a preload assignment is invisible to
 * every git child (the first test below pins that behaviour, because it is the whole
 * reason the fix lives where it does). `scripts/test/run.ts` puts the pinned config on
 * the child's *startup* environment instead, which every descendant inherits normally.
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

  test('bun does not propagate a runtime env assignment to a child process', () => {
    // The constraint that decides where the fix lives. If this ever starts passing,
    // `tests/setup.ts` becomes a viable home again and this file can be revisited.
    process.env['PAPAI_ENV_PROPAGATION_PROBE'] = 'set-at-runtime'
    try {
      const seen = spawnSync('sh', ['-c', 'printf %s "$PAPAI_ENV_PROPAGATION_PROBE"'], { encoding: 'utf8' })

      expect(seen.stdout).toBe('')
    } finally {
      delete process.env['PAPAI_ENV_PROPAGATION_PROBE']
    }
  })
})
