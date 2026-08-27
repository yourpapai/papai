// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { parsePorcelainPaths } from '../../mutation-improve/src/diff-guard.js'
import type { ExecGitFn } from './config.js'

export class DiffGuardViolationError extends Error {
  readonly violations: readonly string[]

  constructor(violations: readonly string[]) {
    super(`agent edited files outside the change folder: ${violations.join(', ')}`)
    this.name = 'DiffGuardViolationError'
    this.violations = violations
  }
}

const CHANGES_ROOT = 'openspec/changes/'

/**
 * The write set an agent of this run may dirty: its own change folder when the
 * run names one, else the whole changes tree. Scoping to the run's own folder
 * is what stops an agent rewriting a *different* change's artifacts — the
 * broad fallback exists only for callers with no change in hand.
 */
function allowedPrefix(changeName: string | undefined): string {
  if (changeName === undefined || changeName === '') return CHANGES_ROOT
  return `${CHANGES_ROOT}${changeName}/`
}

function parseDirty(stdout: string): string[] {
  return stdout
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .flatMap(parsePorcelainPaths)
    .filter((entry) => entry.length > 0)
}

export async function snapshotWorkingTree(execGit: ExecGitFn, cwd: string): Promise<Set<string>> {
  const { stdout } = await execGit(cwd, ['status', '--porcelain', '--untracked-files=all'])
  return new Set(parseDirty(stdout))
}

export async function guardWorkingTree(
  execGit: ExecGitFn,
  cwd: string,
  before: Set<string>,
  changeName?: string,
): Promise<void> {
  const after = await snapshotWorkingTree(execGit, cwd)
  const prefix = allowedPrefix(changeName)
  const violations = [...after].filter((entry) => !before.has(entry) && !entry.startsWith(prefix))
  if (violations.length > 0) throw new DiffGuardViolationError(violations)
}
