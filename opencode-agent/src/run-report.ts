// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { IssueComment } from './blocks.js'
import type { PhaseDeps, PhaseInput } from './phase-context.js'
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
  return [...thread, { id: posted.id, body: rendered, authorLogin: input.deps.config.selfLogin }]
}

export const renderClosing = (state: AgentState): string =>
  state.prUrl === null
    ? ['### Stopped', '', 'This issue is no longer being worked on. Comment again to restart the conversation.'].join(
        '\n',
      )
    : ['### Done', '', `The work is in ${state.prUrl}.`].join('\n')

export const renderSettled = (state: AgentState): string =>
  state.phase === 'COMPLETE' ? renderClosing(state) : `### Waiting\n\nParked in \`${state.phase}\`.`

export const renderExhausted = (reason: string): string =>
  ['### Giving up', '', reason, '', 'Fix the underlying problem, then reply `/retry`.'].join('\n')

export const renderFailure = (phase: Phase, message: string, next: AgentState, deps: PhaseDeps): string =>
  [
    `### Run failed in ${phase}`,
    '',
    '```',
    message,
    '```',
    '',
    `Attempt ${next.attempts} of ${deps.config.maxAttempts}. Reply **\`/retry\`** to resume from \`${phase}\`, ` +
      'or **`/cancel`** to stop.',
  ].join('\n')
