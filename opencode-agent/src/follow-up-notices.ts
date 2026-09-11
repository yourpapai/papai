// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { CheckFailure } from './check-loop.js'
import { fence } from './markdown.js'
import { outcomeHeading } from './outcomes.js'

/**
 * What a `/follow-up` run says, in every way it can end.
 *
 * Beside `sync-notices.ts` along the same seam that file cut: renderers change
 * when a reader's question does, the handler when the work does. The two rules
 * are inherited. Every heading comes through `outcomeHeading`, so no renderer
 * invents a glyph — ⚠️ for the failures is the `ANSWER_FAILED` decision
 * restated: a follow-up is a side operation, nothing about the state moved,
 * and ❌ would tell a maintainer their delivered issue had failed. And the
 * one decision this module is named for: a decline is **not** a failure. The
 * size gate saying "too big" is the command working as designed — `completed`
 * on the run, with the reason and the issue draft in the reply — where
 * `failed` would paint the job red for correct behaviour and `skipped` would
 * understate a turn that paid and posted.
 */

/** How the branch's pull request is named in a remedy line, when there is one. */
const prRef = (prUrl: string | null): string => (prUrl === null ? '' : ` (${prUrl})`)

/** The one remedy every hard failure shares, said the same way each time. */
const humanRemedy = (prUrl: string | null): string =>
  'A maintainer can make this change where the permissions already exist: open the pull request' +
  prRef(prUrl) +
  ' and apply it there, or reply `/review` for a full pass over the branch.'

/**
 * The size gate declined the request.
 *
 * The draft is ready to paste: a title line and a scoped description that
 * references the pull request, so the maintainer's next step is one copy, not
 * one composition.
 */
export const renderFollowUpDecline = (reason: string, prUrl: string | null): string =>
  [
    outcomeHeading('ANSWER_FAILED', 'I judged this follow-up too big to apply directly'),
    '',
    `The size gate's verdict: ${reason}`,
    '',
    'Nothing was applied — no commit, no push, the branch is exactly as it was. This is worth its own issue instead.',
    '',
    'Ready to paste into a new issue:',
    '',
    fence(
      [
        'Title',
        '',
        'Follow-up on the delivered pull request: ' + (prUrl ?? 'the agent branch'),
        '',
        'Description',
        '',
        reason,
      ].join('\n'),
    ),
  ].join('\n')

/** What the applied path reports: the verdict, the files, the checks, the sha. */
export interface FollowUpAppliedReport {
  /** The size gate's verdict, restated — the decision and reason, on both paths. */
  reason: string
  summary: string
  files: readonly string[]
  /** The checks that ran and passed, named as they were run. */
  checks: readonly string[]
  /** The head the remote accepted, read after the push. */
  sha: string
  /** Protected or stray paths the staging guard dropped, if any. */
  dropped: readonly string[]
}

export const renderFollowUpApplied = (report: FollowUpAppliedReport): string =>
  [
    '### Follow-up applied',
    '',
    `The size gate judged it **small**: ${report.reason}`,
    '',
    report.summary,
    '',
    report.files.length > 0 ? `Files: ${report.files.map((file) => `\`${file}\``).join(', ')}.` : 'No files changed.',
    `Checks green: ${report.checks.map((check) => `\`${check}\``).join(', ')}.`,
    `Pushed as \`${report.sha}\` on the agent branch.`,
    ...(report.dropped.length > 0
      ? [
          '',
          `Files the staging guard dropped (this pipeline may not push them): ${report.dropped
            .map((path) => `\`${path}\``)
            .join(', ')}. A maintainer must apply those by hand.`,
        ]
      : []),
  ].join('\n')

/**
 * Checks went red after the apply turn: the one outcome where the gate's
 * "small" verdict is overruled by the repository itself. Nothing was committed
 * and nothing was pushed — the branch is exactly as the command found it — and
 * the reply says what ran, because the proof of the failure is the command
 * list, not the exit code.
 */
export const renderFollowUpChecksRed = (
  ran: readonly string[],
  failures: readonly CheckFailure[],
  prUrl: string | null,
): string =>
  [
    outcomeHeading('ANSWER_FAILED', 'The follow-up failed its checks — nothing was pushed'),
    '',
    `The apply turn finished, but the checks the pipeline ran did not pass: ${failures
      .map((failure) => `**${failure.name}** (exit ${failure.exitCode})`)
      .join(', ')}.`,
    '',
    `What ran: ${ran.map((check) => `\`${check}\``).join(', ')}.`,
    '',
    fence(failures.map((failure) => `${failure.name} (exit ${failure.exitCode})\n${failure.output}`).join('\n\n')),
    '',
    'Nothing was committed and nothing was pushed — the branch is exactly as this command found it.',
    humanRemedy(prUrl),
  ].join('\n')

export const renderFollowUpOverBudget = (spent: number, limit: number, branch: string, prUrl: string | null): string =>
  [
    outcomeHeading('ANSWER_TOKENS_SPENT', 'Token budget spent'),
    '',
    `This issue has used ${spent.toLocaleString('en-US')} model tokens of the ${limit.toLocaleString('en-US')} it is ` +
      `allowed. I did not start the size-gate turn for \`${branch}\`.`,
    '',
    'Nothing has changed: no phase moved, no turn ran, the branch is as it was.',
    'Raise `AGENT_MAX_TOKENS` in the workflow and reply `/follow-up` again' +
      prRef(prUrl) +
      ', or make the change by hand.',
  ].join('\n')

export const renderFollowUpFailure = (phase: string, branch: string, message: string): string =>
  [
    outcomeHeading('ANSWER_FAILED', `I could not apply the follow-up on \`${branch}\``),
    '',
    message,
    '',
    `Nothing has changed: this issue is still in \`${phase}\` and the branch is as this command found it.`,
  ].join('\n')
