// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { IssueComment } from './blocks.js'
import { acceptedCommands } from './commands.js'
import { reportIdentityDrift } from './identity.js'
import { fence } from './markdown.js'
import { outcomeHeading } from './outcomes.js'
import type { PhaseInput } from './phase-context.js'
import { phaseHeading, presentationFor } from './presentation.js'
import { renderStateComment } from './state-manager.js'
import type { AgentState, Phase } from './types.js'

/**
 * Everything the orchestrator writes back to the issue.
 *
 * Split out because the state machine and the way it narrates itself change for
 * different reasons — and because every one of these functions ends in the same
 * `postAndAppend`, which is the pipeline's only durable write.
 *
 * What a **bound reached** says lives next door in `budget-notices.ts`, along a
 * seam `presentation.ts` had already drawn: ❌ means the work broke, ⛔ means a
 * ceiling stopped a run in which nothing broke at all. This file is the first
 * half — a failure, a park, a refusal, a closing — and it moved when a fourth
 * budget notice would not fit beside the others.
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
 * The two branches say opposite things about what happens next, and both are
 * checked against the machine. A **delivered** issue now accepts one command —
 * `/review`, the first `COMPLETE` has ever taken — so the closing comment names
 * it: a command nobody can discover is not a feature. A **cancelled** issue
 * accepts none, and its wording has to say that plainly; an earlier draft
 * invited the maintainer to "comment again to restart the conversation", which
 * the state machine then refused with an unhelpful `No actionable command while
 * in COMPLETE`. That line stays true beside the new offer above it, because the
 * applicability predicate in `commands.ts` refuses `/review` without a pull
 * request — which is exactly what a cancelled issue has none of.
 */
export const renderClosing = (state: AgentState): string =>
  state.prUrl === null
    ? [
        // Through the *phase* table rather than the outcome one: these two
        // headings are `COMPLETE:cancelled` and `COMPLETE:delivered`, the same
        // two states the label reconciler is naming on this very comment, and a
        // second copy of the glyph could only ever drift from the label beside
        // it.
        phaseHeading(state, 'waiting', 'Stopped'),
        '',
        'I am no longer working on this issue, and further comments here will not restart me.',
        'Open a new issue if you want this picked up again.',
      ].join('\n')
    : [
        phaseHeading(state, 'waiting', 'Done'),
        '',
        `The work is in ${state.prUrl}.`,
        '',
        'If that pull request goes red I will still pick it up and push a fix.',
        // Named there rather than here on purpose: with a pull request open, a
        // command typed on this issue is refused and pointed at it — see
        // `feedback-target.ts` — so inviting one here would be inviting a refusal.
        'Comment **`/review`** *on the pull request* to run the review loop over the branch and push what it finds.',
      ].join('\n')

/**
 * What a maintainer can type from here, named from the transition table.
 *
 * Shared by the two comments that have to answer that question — a refused
 * command and a parked phase — because they are the same sentence and were on
 * their way to being two.
 */
const acceptedLine = (accepted: readonly string[]): string =>
  accepted.length === 0
    ? 'No command moves this issue on from here.'
    : `What works here: ${accepted.map((name) => `\`${name}\``).join(', ')}.`

/**
 * The comment that ends a run at a phase with no handler.
 *
 * It used to render `### Waiting` over `Parked in \`PLAN_REVIEW\`.` and stop
 * there — the phase name, and no statement of what would move it, while every
 * other waiting comment in this file carries a "what now". A maintainer reading
 * it learned only that the agent had stopped, in a vocabulary (`PLAN_REVIEW`)
 * that means nothing to anyone who has not read the state machine.
 *
 * Both halves are derived rather than written: the headline and glyph come from
 * the presentation table, and the commands from the same `acceptedCommands` the
 * refusal comment uses, so neither can drift from what the machine will take.
 */
const renderWaiting = (state: AgentState): string => {
  const { headline } = presentationFor(state, 'waiting')

  return [
    phaseHeading(state, 'waiting', headline),
    '',
    `Parked in \`${state.phase}\`, and nothing moves until you say so.`,
    '',
    acceptedLine(acceptedCommands(state)),
  ].join('\n')
}

export const renderSettled = (state: AgentState): string =>
  state.phase === 'COMPLETE' ? renderClosing(state) : renderWaiting(state)

/**
 * The reply to a slash command the current phase cannot accept.
 *
 * A maintainer typed something and is waiting for it to happen; skipping in
 * silence leaves them watching an issue that will never move, with the reason
 * buried in an Actions log nobody opens. That is how a mis-set
 * `AGENT_SELF_LOGIN` stayed invisible: every `/changes` was refused against a
 * freshly-restarted state and nothing was ever posted.
 *
 * The accepted list is derived from the transition table rather than written
 * out here, so it cannot drift away from what the machine will actually take.
 */
/**
 * The reply to a command typed in the right words on the wrong page.
 *
 * Separate from {@link renderRefusedCommand} because that one's sentence — "I am
 * parked in `X`, which does not accept it" — would be false here twice over: the
 * phase accepts the command perfectly well, and nothing about the state is the
 * reason. The only fact worth saying is where to type it again, so that is the
 * whole comment.
 *
 * The pull request is named by URL when there is one and by nothing at all when
 * there is not, which cannot happen — `commandSurface` returns `elsewhere` only
 * when `prNumber` is set, and `prUrl` is written beside it — but a renderer that
 * cannot be handed a broken state is one fewer thing to check.
 */
export const renderCommandElsewhere = (command: string, prUrl: string | null): string =>
  [
    outcomeHeading('COMMAND_REFUSED', `\`${command}\` belongs on the pull request now`),
    '',
    prUrl === null
      ? 'This issue has a pull request open, and that is where I take commands from once one exists.'
      : `This issue's work is in ${prUrl}, and that is where I take commands from once a pull request is open.`,
    '',
    `Type \`${command}\` there instead. Nothing has changed here — the report and the state still live on this issue.`,
  ].join('\n')

export const renderRefusedCommand = (command: string, phase: Phase, accepted: readonly string[]): string =>
  [
    outcomeHeading('COMMAND_REFUSED', `\`${command}\` does not apply right now`),
    '',
    `I am parked in \`${phase}\`, which does not accept it, so nothing has changed.`,
    '',
    acceptedLine(accepted),
  ].join('\n')

/**
 * A link to the job, for the comments a maintainer reads when something has
 * gone wrong.
 *
 * Rendered as nothing at all when there is no run: a local `--event-path` run is
 * an ordinary way to drive this CLI, and an empty "Job:" label is worse than a
 * missing line. The URL arrives as an argument rather than being read from
 * config here, so a renderer stays a function of what it is handed.
 */
const jobLink = (runUrl: string | null, label: string): readonly string[] =>
  runUrl === null ? [] : ['', `${label}: ${runUrl}`]

export const renderFailure = (
  phase: Phase,
  message: string,
  next: AgentState,
  maxAttempts: number,
  runUrl: string | null,
): string =>
  [
    outcomeHeading('RUN_FAILED', `Run failed in ${phase}`),
    '',
    // The message carries raw model output, which usually contains fences.
    fence(message),
    // Until now the only lead a maintainer had from this comment was `/retry`.
    // The job that produced the message above has the rest of the story in it,
    // and nothing on the issue said where to find it.
    ...jobLink(runUrl, 'The job that failed'),
    '',
    `Attempt ${next.attempts} of ${maxAttempts}. Reply **\`/retry\`** to resume from \`${phase}\`, ` +
      'or **`/cancel`** to stop.',
  ].join('\n')

/**
 * The reply to a question the agent could not answer.
 *
 * Separate from {@link renderFailure} because nothing failed *about the issue*:
 * the phase has not moved, `resumeFrom` is untouched and no attempt was spent,
 * so the wording has to say that rather than borrow the failure comment's. That
 * comment invites `/retry`, which would be wrong here twice over — there is
 * nothing parked in FAILED for it to resume, and back when a failed answer did
 * park the state, the `/retry` it invited resumed into a waiting phase with no
 * handler and re-parked with "Parked in `DESIGN_SPEC`", one attempt poorer.
 */
export const renderAnswerFailure = (phase: Phase, message: string): string =>
  [
    outcomeHeading('ANSWER_FAILED', 'I could not answer that'),
    '',
    // The message carries raw model output, which usually contains fences.
    fence(message),
    '',
    `Nothing has changed: this issue is still in \`${phase}\`. Ask again, or carry on where you were.`,
  ].join('\n')
