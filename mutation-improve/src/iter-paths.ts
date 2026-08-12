// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'

/**
 * Iteration-scoped identifiers derived from the run state and iteration index.
 * Extracted from pipeline.ts to keep that file under the repo's max-lines cap.
 * Takes a structural slice of PipelineDeps rather than importing it, so there is
 * no cycle between this module and pipeline.ts.
 */
interface IterDeps {
  config: { prBranchPrefix: string; workDir: string }
  runState: { runId: string }
}

export function branchFor(deps: IterDeps, iter: number): string {
  return `${deps.config.prBranchPrefix}/${deps.runState.runId}-iter${iter}`
}

export function worktreeFor(deps: IterDeps, iter: number): string {
  return path.join(deps.config.workDir, 'worktrees', `${deps.runState.runId}-iter${iter}`)
}

export function runIdFor(deps: IterDeps, iter: number): string {
  return `${deps.runState.runId}-iter${iter}`
}
