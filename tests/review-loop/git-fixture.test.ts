// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { createWorktree, execGit } from '../../review-loop/src/worktree.js'
import { makeGitFixture, type GitFixtureDeps } from './git-fixture.js'
import { cleanupTempDirs, makeTempDir } from './test-helpers.js'

afterEach(cleanupTempDirs)

/** Records every seam call and still runs real git, so a first-call template build stays functional. */
function recordingGit(): { deps: GitFixtureDeps; calls: string[][] } {
  const calls: string[][] = []
  return {
    calls,
    deps: {
      runGit: (cwd, args) => {
        calls.push([...args])
        return execFileSync('git', [...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      },
    },
  }
}

describe('makeGitFixture', () => {
  test('returns a repo with the template commit whose commits need no identity setup', async () => {
    const repo = makeGitFixture('fixture-')

    const log = await execGit(repo, ['log', '--oneline'])
    expect(log.stdout).toContain('init')
    expect(existsSync(path.join(repo, 'README.md'))).toBe(true)

    writeFileSync(path.join(repo, 'new.txt'), 'x')
    await execGit(repo, ['add', 'new.txt'])
    const commit = await execGit(repo, ['commit', '-m', 'second'])
    expect(commit.stdout).toContain('second')
  })

  test('two fixtures are isolated: mutating one leaves the other unchanged', async () => {
    const a = makeGitFixture('iso-a-')
    const b = makeGitFixture('iso-b-')
    const headBefore = (await execGit(b, ['rev-parse', 'HEAD'])).stdout
    const branchesBefore = (await execGit(b, ['branch', '--list'])).stdout
    const treeBefore = (await execGit(b, ['ls-files'])).stdout

    writeFileSync(path.join(a, 'a.txt'), 'a')
    await execGit(a, ['add', '.'])
    await execGit(a, ['commit', '-m', 'a-change'])
    await execGit(a, ['branch', 'side-branch'])
    await execGit(a, ['reset', '--hard', 'HEAD~1'])

    expect((await execGit(b, ['rev-parse', 'HEAD'])).stdout).toBe(headBefore)
    expect((await execGit(b, ['branch', '--list'])).stdout).toBe(branchesBefore)
    expect((await execGit(b, ['ls-files'])).stdout).toBe(treeBefore)
  })

  test('fixture construction after the first spawns no git process', () => {
    const first = recordingGit()
    makeGitFixture('probe-1-', first.deps)
    const second = recordingGit()
    makeGitFixture('probe-2-', second.deps)

    expect(second.calls).toEqual([])
    const inits = [...first.calls, ...second.calls].filter((args) => args[0] === 'init')
    expect(inits.length).toBeLessThanOrEqual(1)
  })

  test('copies carry gc.auto=0 from the template', async () => {
    const repo = makeGitFixture('gc-')

    const { stdout } = await execGit(repo, ['config', 'gc.auto'])
    expect(stdout.trim()).toBe('0')
  })

  test('worktree add on a copy succeeds and behaves as from a built repo', async () => {
    const copied = makeGitFixture('wt-copy-')
    // The pre-helper recipe, inline: the parity baseline.
    const built = makeTempDir('wt-built-')
    await execGit(built, ['init'])
    await execGit(built, ['config', 'user.email', 't@t.com'])
    await execGit(built, ['config', 'user.name', 'T'])
    writeFileSync(path.join(built, 'README.md'), 'init')
    await execGit(built, ['add', '.'])
    await execGit(built, ['commit', '-m', 'init'])

    for (const repo of [copied, built]) {
      const worktreePath = path.join(repo, 'wt')
      await createWorktree(repo, worktreePath, 'run-1')
      writeFileSync(path.join(worktreePath, 'fix.txt'), 'fixed')
      await execGit(worktreePath, ['add', '.'])
      await execGit(worktreePath, ['commit', '-m', 'fix'])
      await execGit(repo, ['merge', '--ff-only', 'review-loop/run-1'])
      expect(existsSync(path.join(repo, 'fix.txt'))).toBe(true)
    }
  })
})
