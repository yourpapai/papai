// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { PhaseHandler, PhaseOutcome } from '../phase-context.js'
import type { TriggerEvent } from '../trigger-events.js'

/**
 * The archive door (design D7): a merged pull request on `agent/issue-<n>`
 * runs `openspec archive` as a follow-up commit on the base branch, closing the
 * propose → apply → archive loop.
 *
 * The handler is one shot: it checks out the base branch the merged PR targeted
 * (`pull_request.base.ref`), archives the change folder the issue carried, and
 * pushes. No model turn — archiving is a file move the CLI owns, not content the
 * model composes, so no OpenCode session boots. Reached only from `COMPLETE` on
 * `PR_MERGED`, and never persisted as a waiting state: a second merge event on
 * the same issue finds it back in `COMPLETE`, the folder is already archived,
 * and the archive command is a no-op the diff guard reports as nothing to commit.
 */
export const handleArchive: PhaseHandler = async (input): Promise<PhaseOutcome> => {
  const { deps, state, trigger } = input
  if (state.changeName === null) throw new Error('ARCHIVE reached without a changeName on the state')
  const changeName = state.changeName
  const baseBranch = archiveBaseBranch(trigger, await deps.baseBranch())

  deps.log.info({ issue: state.issueId, change: changeName, base: baseBranch }, 'Archiving merged change')

  // Onto the base branch the merged PR targeted, not `agent/issue-<n>`: the
  // archive is a follow-up commit on master, and the agent branch dies with the
  // merge. `ensureBranch(base, base)` checks out the base branch from itself.
  await deps.git.ensureBranch(baseBranch, baseBranch)
  await deps.openspec.archive(changeName)
  await deps.git.commitAll(`chore(openspec): archive ${changeName}\n\nCloses #${state.issueId}`)
  await deps.git.push(baseBranch)

  return {
    signal: 'ARCHIVED',
    comment: renderArchiveComment(changeName),
  }
}

/**
 * The branch the archive commits to: the merged PR's base when the trigger
 * carries it (the honest answer — that is the branch the maintainer merged
 * into), falling back to the resolved base for any other path here.
 */
const archiveBaseBranch = (trigger: TriggerEvent, resolved: string): string =>
  trigger.kind === 'pr-merged' ? trigger.baseBranch : resolved

const renderArchiveComment = (changeName: string): string =>
  [
    '### Archived',
    '',
    `Merged pull request closed the loop: \`${changeName}\` is archived under \`openspec/archive/\`.`,
    '',
    'The change folder left `openspec/changes/` as a follow-up commit on the base branch.',
  ].join('\n')
