// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { outcomeHeading } from './outcomes.js'

/**
 * What a `/sync` run says, in every way it can end.
 *
 * Split from `phases/sync.ts` along the seam `budget-notices.ts` and
 * `time-notices.ts` already drew — renderers move out when the handler that
 * owns them reaches `max-lines`, and they change for a different reason: the
 * wording changes when a reader's question does, the handler when the merge
 * does.
 *
 * Two rules inherited from those modules. Every heading comes through
 * `outcomeHeading`, so no renderer invents a glyph — ⚠️ for the failures is
 * the `ANSWER_FAILED` decision restated: a sync is a side operation, nothing
 * moved, and ❌ would tell a maintainer their delivered pull request had
 * failed. And every failure names a remedy that actually works — the
 * update-branch control, never a `/retry`-shaped promise the state machine
 * cannot keep.
 */

/** How the branch's pull request is named in a remedy line, when there is one. */
const prRef = (prUrl: string | null): string => (prUrl === null ? '' : ` (${prUrl})`)

/** The one remedy every failed sync shares, said the same way each time. */
const humanRemedy = (prUrl: string | null): string =>
  'A maintainer can do this merge where the permission already exists: open the pull request' +
  prRef(prUrl) +
  ' and use its own **Update branch** control (update-branch).'

export const renderUpToDate = (branch: string, base: string): string =>
  [
    '### Branch up to date',
    '',
    `\`${branch}\` already contains everything on \`${base}\` — nothing to merge, nothing pushed.`,
    'Nothing else changed: no phase moved and no budget was spent.',
  ].join('\n')

export const renderMerged = (commits: number, branch: string, base: string): string =>
  [
    `### Synced with \`${base}\``,
    '',
    `Merged ${commits} commit${commits === 1 ? '' : 's'} from \`${base}\` into \`${branch}\` and pushed the merge.`,
    'Nothing else changed: no phase moved and no budget was spent. Checks run on the push itself.',
  ].join('\n')

export const renderResolved = (rounds: number, branch: string, base: string): string =>
  [
    '### Conflicts resolved',
    '',
    `Merging \`${base}\` into \`${branch}\` conflicted; I resolved the markers in ${rounds} repair round${rounds === 1 ? '' : 's'} ` +
      'and the pipeline completed the merge and pushed it.',
    'The resolution is unverified by checks — they run on the push, and anything they find arrives through the usual red-CI door.',
  ].join('\n')

export const renderExhausted = (
  rounds: number,
  maxRounds: number,
  branch: string,
  base: string,
  remaining: readonly string[],
  prUrl: string | null,
): string =>
  [
    outcomeHeading('ANSWER_FAILED', `I could not sync \`${branch}\` with \`${base}\``),
    '',
    `Every repair round (${rounds} of \`AGENT_SYNC_REPAIR_MAX_ROUNDS\` = ${maxRounds}) ended with conflict markers still ` +
      `present in ${remaining.map((path) => `\`${path}\``).join(', ')}. I aborted the merge and left the branch exactly ` +
      'as it was — nothing moved, nothing was pushed.',
    '',
    humanRemedy(prUrl),
  ].join('\n')

export const renderSyncOverBudget = (
  spent: number,
  limit: number,
  branch: string,
  base: string,
  prUrl: string | null,
): string =>
  [
    outcomeHeading('ANSWER_TOKENS_SPENT', 'Token budget spent'),
    '',
    `This issue has used ${spent.toLocaleString('en-US')} model tokens of the ${limit.toLocaleString('en-US')} it is ` +
      `allowed. Merging \`${base}\` into \`${branch}\` conflicted, and I did not start a repair turn.`,
    '',
    'Nothing has changed: no phase moved and the merge was aborted, leaving the branch as it was.',
    'Raise `AGENT_MAX_TOKENS` in the workflow and reply `/sync` again, or do the merge by hand: open the pull request' +
      prRef(prUrl) +
      ' and use its own **Update branch** control (update-branch).',
  ].join('\n')

export const renderPushForbidden = (base: string, prUrl: string | null): string =>
  [
    outcomeHeading('ANSWER_FAILED', `I merged \`${base}\` but could not push it`),
    '',
    'The merge completed locally, but GitHub refused the push: this pipeline\u2019s token may not push changes to ' +
      'files under `.github/workflows/`, and base\u2019s own workflow edits are part of the merge. That content is ' +
      'base\u2019s, already reviewed — nothing of yours is lost, and the branch is simply without the merge for now.',
    '',
    humanRemedy(prUrl),
  ].join('\n')

export const renderSyncFailure = (phase: string, branch: string, base: string, message: string): string =>
  [
    outcomeHeading('ANSWER_FAILED', `I could not sync \`${branch}\` with \`${base}\``),
    '',
    message,
    '',
    `Nothing has changed: this issue is still in \`${phase}\` and the branch is as it was.`,
  ].join('\n')
