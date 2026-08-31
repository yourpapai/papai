// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'

import type { AnalyzeFs, AnalyzeGit } from './analyze-io.js'
import { changeDirOf, readChangeFolder } from './analyze-io.js'

/**
 * Ground-truth join: for each analyzed run's change folder — tasks
 * done/total, folder existence, commit count on the current branch, and
 * presence on a main ref — surfacing stranded-complete (planning done,
 * unmerged) and merged-unimplemented (merged, zero tasks done) changes, the
 * two failure classes nothing watches. All git access goes through the
 * read-only `log`/`ls-tree` seam.
 */

export interface ChangeRef {
  readonly repoRoot: string
  readonly changeName: string
}

export interface ChangeGroundTruth {
  readonly changeName: string
  readonly repoRoot: string
  readonly exists: boolean
  readonly tasksDone: number
  readonly tasksTotal: number
  readonly commits: number
  readonly onMainBranch: boolean
  readonly strandedComplete: boolean
  readonly mergedUnimplemented: boolean
}

/** Default candidate main refs, first match wins. */
export const MAIN_REF_CANDIDATES: readonly string[] = ['main', 'master']

export function groundTruthJoin(
  fs: AnalyzeFs,
  git: AnalyzeGit,
  changes: readonly ChangeRef[],
  mainRefs: readonly string[] = MAIN_REF_CANDIDATES,
): Promise<readonly ChangeGroundTruth[]> {
  const seen = new Set<string>()
  const unique = changes.filter((change): boolean => {
    const key = `${change.repoRoot}\0${change.changeName}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return Promise.all(unique.map((change) => joinChange(fs, git, change, mainRefs)))
}

async function joinChange(
  fs: AnalyzeFs,
  git: AnalyzeGit,
  change: ChangeRef,
  mainRefs: readonly string[],
): Promise<ChangeGroundTruth> {
  const folder = await readChangeFolder(fs, change.repoRoot, change.changeName)
  const commits = await commitCountOf(git, change.repoRoot, changeDirOf(change.repoRoot, change.changeName))
  const onMainBranch = await presentOnMainRef(git, change.repoRoot, change.changeName, mainRefs)
  const strandedComplete =
    folder.exists && folder.tasksTotal > 0 && folder.tasksDone === folder.tasksTotal && !onMainBranch
  const mergedUnimplemented = onMainBranch && folder.tasksDone === 0
  return {
    changeName: change.changeName,
    repoRoot: change.repoRoot,
    exists: folder.exists,
    tasksDone: folder.tasksDone,
    tasksTotal: folder.tasksTotal,
    commits,
    onMainBranch,
    strandedComplete,
    mergedUnimplemented,
  }
}

async function commitCountOf(git: AnalyzeGit, repoRoot: string, changeDir: string): Promise<number> {
  const { stdout } = await git(repoRoot, ['log', '--oneline', '--', changeDir]).catch(() => ({
    stdout: '',
    stderr: '',
  }))
  return stdout.split('\n').filter((line) => line.trim().length > 0).length
}

async function presentOnMainRef(
  git: AnalyzeGit,
  repoRoot: string,
  changeName: string,
  mainRefs: readonly string[],
): Promise<boolean> {
  const relative = path.join('openspec', 'changes', changeName)
  const perRef = await Promise.all(
    mainRefs.map(async (ref): Promise<boolean> => {
      const { stdout } = await git(repoRoot, ['ls-tree', ref, relative]).catch(() => ({ stdout: '', stderr: '' }))
      return stdout.trim().length > 0
    }),
  )
  return perRef.some((present) => present)
}
