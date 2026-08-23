// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { buildCommitRepairPrompt, commitWithRepair } from '../commit-repair.js'
import { droppedBy } from '../git-commit.js'
import type { OpenCodeAgent } from '../opencode-adapter.js'
import type { PhaseInput } from '../phase-context.js'
import type { UntrustedEnvelope } from '../prompts.js'
import type { RoundCommit } from './ci-report.js'

/**
 * What making a CI-fix repair durable costs — the commit, the repair rounds
 * `commit-repair.ts` drives, and the push. Split from `ci-fix.ts` along the
 * seam `phases/implement-commit.ts` cut for the implementation: the flow
 * changes and the commit ceremony does not.
 */

/** The session and the two things every repair prompt is composed against. */
export interface CiTurn {
  agent: OpenCodeAgent
  envelope: UntrustedEnvelope
  system: string
}

/**
 * Commits the repair, and lets the repository refuse it once or twice first.
 *
 * The checks a round reproduces are the ones **CI** ran; the ones a commit has
 * to satisfy are the repository's own, over the staged files, and they are not
 * the same set — so a round that got its derived command green can still be
 * turned away at the commit, which used to lose the fix and the whole phase
 * with it. Same treatment as the implementation's commit, and the same
 * session: this one has the repair in its context already.
 */
export const commitAndPush = async (input: PhaseInput, branch: string, turn: CiTurn): Promise<RoundCommit> => {
  const { deps, state } = input
  const committed = await commitWithRepair({
    commit: () => deps.git.commitAll(`fix(agent): repair CI for issue #${state.issueId}\n\nRefs #${state.issueId}`),
    repair: async (rejection, round) => {
      await turn.agent.prompt({
        system: turn.system,
        prompt: buildCommitRepairPrompt(turn.envelope, rejection, round),
        agent: 'build',
      })
    },
    maxRounds: deps.config.commitRepairMaxRounds,
    log: deps.log,
    issue: state.issueId,
  })
  if (committed.kind !== 'committed') return { pushed: false, dropped: droppedBy(committed) }

  await deps.git.push(branch)
  return { pushed: true, dropped: committed.dropped }
}
