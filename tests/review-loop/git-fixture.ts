// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { makeTempDir } from './test-helpers.js'

export interface GitFixtureDeps {
  /**
   * Runs `git <args>` in `cwd` and returns stdout. Must actually execute git —
   * the seam exists so tests can observe spawns, not replace them.
   */
  readonly runGit: (cwd: string, args: readonly string[]) => string
}

const defaultDeps: GitFixtureDeps = {
  runGit: (cwd, args) => execFileSync('git', [...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
}

let templateDir: string | null = null

/**
 * Builds the once-per-worker template repo: today's `setupPrimary` recipe plus
 * `gc.auto=0`. Lives in its own unregistered temp dir so the per-test
 * `cleanupTempDirs` sweep cannot delete it between tests; a process-exit hook
 * removes it when the worker ends.
 */
function buildTemplate(deps: GitFixtureDeps): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'git-fixture-template-'))
  deps.runGit(dir, ['init'])
  deps.runGit(dir, ['config', 'user.email', 't@t.com'])
  deps.runGit(dir, ['config', 'user.name', 'T'])
  deps.runGit(dir, ['config', 'gc.auto', '0'])
  writeFileSync(path.join(dir, 'README.md'), 'init')
  deps.runGit(dir, ['add', '.'])
  deps.runGit(dir, ['commit', '-m', 'init'])
  process.once('exit', () => {
    rmSync(dir, { recursive: true, force: true })
  })
  return dir
}

/**
 * Returns a fresh real git repository (identity configured, one `init` commit,
 * `gc.auto=0`) by copying the per-worker template — no git subprocess per
 * request. Worktrees, merges, and rebases on the copy stay real git; only
 * repository construction is a copy (APFS clonefile via `cpSync`).
 */
export function makeGitFixture(prefix: string, deps: GitFixtureDeps = defaultDeps): string {
  templateDir ??= buildTemplate(deps)
  const repo = makeTempDir(prefix)
  cpSync(templateDir, repo, { recursive: true })
  return repo
}
