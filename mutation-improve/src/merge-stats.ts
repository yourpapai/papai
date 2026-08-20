// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { measureDiffSince } from '../../review-loop/src/diff-stats.js'
import type { PipelineDeps } from './pipeline.js'

type MergeStatsDeps = Pick<PipelineDeps, 'execGit' | 'log'> & {
  config: { repoRoot: string }
}

// Reports the merge diff for an iteration into the run-stats sink. Captured
// after a successful merge against the pre-merge HEAD (beforeSha), so it
// reflects exactly what the iteration's branch landed on the integration
// branch. A measurement failure (e.g. a missing sha) must never abort the
// run, so it degrades to a log line instead of throwing.
export async function reportMergeDiff(deps: MergeStatsDeps, iter: number, beforeSha: string): Promise<void> {
  try {
    const diff = await measureDiffSince(deps.execGit, deps.config.repoRoot, beforeSha)
    deps.log.diff?.(`iter-${iter}`, diff)
  } catch (error) {
    deps.log.log(`[stats] merge diff unavailable: ${error instanceof Error ? error.message : String(error)}`)
  }
}
