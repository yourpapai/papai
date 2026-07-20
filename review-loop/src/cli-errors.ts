// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'

import type { BuildCheckResult } from './build-checker.js'
import type { RunState } from './run-state.js'

const BUILD_OUTPUT_TAIL_LINES = 40

function tailLines(text: string, maxLines: number): string {
  if (text.length === 0) return ''
  const lines = text.split('\n')
  if (lines.length <= maxLines) return text
  const skipped = lines.length - maxLines
  return `…(${skipped} earlier lines truncated; full output in build-check.log)…\n${lines.slice(-maxLines).join('\n')}`
}

export function formatBuildFailureMessage(runState: RunState, build: BuildCheckResult): string {
  const combined = tailLines(
    [build.stdout, build.stderr].filter((part) => part.length > 0).join('\n'),
    BUILD_OUTPUT_TAIL_LINES,
  )
  const logPath = path.join(runState.runDir, 'build-check.log')
  return (
    `Final build check failed; worktree preserved at ${runState.worktreePath} for inspection, merge skipped.\n` +
    `Full build output written to ${logPath}.\n` +
    `----- build output (tail) -----\n${combined}\n-------------------------------`
  )
}

/**
 * Raised by `finalizeRun` when `git merge` of the loop's branch into the user's
 * branch produces conflicts. The merge has already been aborted before this
 * error is raised, so the user's working tree is clean. The loop's branch is
 * preserved so the user can retry manually (`git merge`/`git rebase`) after
 * resolving the listed files.
 */
export class MergeConflictError extends Error {
  readonly branchName: string
  readonly conflictFiles: readonly string[]
  constructor(branchName: string, conflictFiles: readonly string[], runState: RunState) {
    super(formatMergeConflictMessage(branchName, conflictFiles, runState))
    this.name = 'MergeConflictError'
    this.branchName = branchName
    this.conflictFiles = conflictFiles
  }
}

export function formatMergeConflictMessage(
  branchName: string,
  conflictFiles: readonly string[],
  runState: RunState,
): string {
  const fileList =
    conflictFiles.length === 0
      ? '  (git reported a conflict but listed no files)'
      : conflictFiles.map((f) => `  - ${f}`).join('\n')
  return (
    `Merge conflict while bringing ${branchName} into HEAD; the merge was aborted.\n` +
    `Your branch is unchanged. The loop's branch is preserved.\n\n` +
    `Conflicted files (${conflictFiles.length}):\n${fileList}\n\n` +
    `To retry manually:\n` +
    `  git merge ${branchName}\n` +
    `Or rebase the loop's commits onto HEAD one by one:\n` +
    `  git rebase ${branchName}\n\n` +
    `Run artifacts (summary, metrics, trace) written to ${runState.runDir}.\n` +
    `Worktree preserved at ${runState.worktreePath} for inspection.`
  )
}
