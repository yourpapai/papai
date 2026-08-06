// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { bumpScore, type BaselineMap } from './baseline.js'
import type { PipelineDeps } from './pipeline.js'

type SkipRatchetDeps = Pick<PipelineDeps, 'writeBaseline' | 'execGit'> & {
  config: { repoRoot: string }
}

// A skip means the measured score already clears the threshold while the
// baseline floor lags behind. Ratchet the floor directly on the integration
// branch (repoRoot) so future runs don't re-select the file and burn a full
// mutation run rediscovering it. Only baseline.json is staged, so a dirty
// repoRoot working tree is safe.
export async function ratchetVerifiedSkip(
  deps: SkipRatchetDeps,
  baseline: BaselineMap,
  file: string,
  score: number,
): Promise<void> {
  const bumped = bumpScore(baseline, file, score)
  if (bumped[file] === baseline[file]) return
  await deps.writeBaseline(deps.config.repoRoot, bumped)
  await deps.execGit(deps.config.repoRoot, ['add', 'scripts/mutation/baseline.json'])
  await deps.execGit(deps.config.repoRoot, [
    'commit',
    '-m',
    `chore(mutation): ratchet ${file} baseline to ${score} (verified at threshold)`,
  ])
}
