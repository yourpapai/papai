// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { IssueComment } from './blocks.js'
import { reportIdentityDrift } from './identity.js'
import { fence } from './markdown.js'
import type { PhaseInput } from './phase-context.js'
import { renderStateComment } from './state-manager.js'
import type { AgentState, Phase } from './types.js'

/**
 * Everything the orchestrator writes back to the issue.
 *
 * Split out because the state machine and the way it narrates itself change for
 * different reasons — and because every one of these functions ends in the same
 * `postAndAppend`, which is the pipeline's only durable write.
 */

/**
 * Posts a comment and mirrors it into the in-memory thread, so a later phase in
 * the same job can read an artefact the earlier phase just wrote without
 * re-fetching the issue.
 */
export const postAndAppend = async (
  thread: readonly IssueComment[],
  input: PhaseInput,
  body: string,
  state: AgentState,
  blocks?: readonly string[],
): Promise<IssueComment[]> => {
  const artifacts = blocks === undefined || blocks.length === 0 ? '' : `\n\n${blocks.join('\n\n')}`
  const rendered = `${renderStateComment(body, state)}${artifacts}`

  const posted = await input.deps.github.createComment(input.issue.number, rendered)
  // The recorded author, not the one the pipeline believes in: if they differ,
  // the in-job mirror would otherwise disagree with what a later job reads back.
  reportIdentityDrift(await input.deps.selfLogin(), posted.authorLogin, input.deps.log)

  return [...thread, { id: posted.id, body: rendered, authorLogin: posted.authorLogin }]
}

/**
 * The comment that ends a run in `COMPLETE`.
 *
 * `COMPLETE` accepts no command and no plain comment — the only way back in is a
 * red CI run on the delivered branch. So the cancelled wording has to say that
 * plainly: an earlier draft invited the maintainer to "comment again to restart
 * the conversation", which the state machine then refused with an unhelpful
 * `No actionable command while in COMPLETE`.
 */
export const renderClosing = (state: AgentState): string =>
  state.prUrl === null
    ? [
        '### Stopped',
        '',
        'I am no longer working on this issue, and further comments here will not restart me.',
        'Open a new issue if you want this picked up again.',
      ].join('\n')
    : [
        '### Done',
        '',
        `The work is in ${state.prUrl}.`,
        '',
        'If that pull request goes red I will still pick it up and push a fix.',
      ].join('\n')

export const renderSettled = (state: AgentState): string =>
  state.phase === 'COMPLETE' ? renderClosing(state) : `### Waiting\n\nParked in \`${state.phase}\`.`

export const renderExhausted = (reason: string): string =>
  ['### Giving up', '', reason, '', 'Fix the underlying problem, then reply `/retry`.'].join('\n')

/**
 * The CI-fix equivalent, and the one that matters more.
 *
 * A red check arrives asynchronously with nobody watching the Actions log, so a
 * silent give-up looks exactly like an agent still working on it. Posted once —
 * `ciBudgetReported` stops every later red run repeating it.
 */
export const renderCiExhausted = (reason: string, prUrl: string | null): string =>
  [
    '### I have stopped trying to fix CI',
    '',
    reason,
    '',
    prUrl === null ? 'The pull request is still open.' : `The pull request is still open: ${prUrl}`,
    'Its checks are red and I will not attempt another fix — take a look, or push a fix yourself.',
  ].join('\n')

export const renderFailure = (phase: Phase, message: string, next: AgentState, maxAttempts: number): string =>
  [
    `### Run failed in ${phase}`,
    '',
    // The message carries raw model output, which usually contains fences.
    fence(message),
    '',
    `Attempt ${next.attempts} of ${maxAttempts}. Reply **\`/retry\`** to resume from \`${phase}\`, ` +
      'or **`/cancel`** to stop.',
  ].join('\n')

/**
 * The token-budget notice.
 *
 * Separate from {@link renderExhausted} because the remedy is different, and
 * telling someone to reply `/retry` here would be a lie: the spend is persisted,
 * so a retry re-reads the same total and stops again immediately. The only ways
 * forward are a bigger budget or a fresh issue, and the notice says so.
 */
export const renderOverBudget = (spent: number, limit: number): string =>
  [
    '### Token budget spent',
    '',
    `This issue has used ${spent.toLocaleString('en-US')} model tokens of the ${limit.toLocaleString('en-US')} it is allowed.`,
    '',
    'The count carries across every job this issue has run, so `/retry` will stop here again.',
    'Raise `AGENT_MAX_TOKENS` in the workflow to continue, or open a fresh issue for the remaining work.',
  ].join('\n')
