// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { IssueComment } from './blocks.js'
import { feedbackTarget } from './feedback-target.js'
import { reportIdentityDrift } from './identity.js'
import type { PhaseInput } from './phase-context.js'
import { renderStateComment } from './state-manager.js'
import { persistState } from './state-persist.js'
import type { AgentState } from './types.js'

/**
 * The two writes this pipeline makes to a conversation, and the one line they
 * both carry.
 *
 * Split from `run-report.ts` when the surface move (design D4) pushed that file
 * past `max-lines`, along a seam it already described in its own first sentence:
 * everything left there *renders* — a failure, a park, a refusal, a closing —
 * and this is what *posts*. The two change for entirely different reasons. A
 * renderer changes when the wording does; these two change when the answer to
 * "which page, and does it carry the record" changes, which is a question about
 * the restore scan and the state machine rather than about prose.
 *
 * `postAndAppend` is the pipeline's only durable write and the only place a
 * state block is appended. `postAnswer` is the one comment that is deliberately
 * not a record.
 */

/**
 * The one line every issue comment gains once a pull request has taken the
 * commands over.
 *
 * Almost everything this file renders ends by naming a command — "reply
 * `/retry`", "reply `/cancel`", "raise the ceiling and reply `/review`" — and
 * every one of those became wrong in the same way the day the issue started
 * refusing commands: the advice is right, the page it is written on is not. The
 * alternative was to thread a "where" through eight renderers and their
 * signatures, where each one could forget; this is the same statement made once,
 * on the write they all share, from the state they are all posted with.
 *
 * Empty while there is no pull request, which is most of an issue's life and all
 * of a cancelled one's — so a run that never delivers reads exactly as it did.
 */
const commandPointer = (state: AgentState): string =>
  state.prUrl === null ? '' : `\n\n_Commands for this issue go on its pull request: ${state.prUrl}_`

/**
 * Posts a comment and mirrors it into the in-memory thread, so a later phase in
 * the same job can read an artefact the earlier phase just wrote without
 * re-fetching the issue.
 *
 * Addressed at {@link feedbackTarget}, so once a pull request exists the body
 * **and its state block** land there. That block used to be the one thing that
 * could not move: `findLatestState` scanned exactly one thread, so a block on
 * the pull request was a second source of truth the scan could never see. The
 * answer is not to split the write — a rendered comment here and a rewritten
 * block over there — but to move the scan, which `readThread` in
 * `orchestrator.ts` now does in two passes. Splitting them would have made the
 * record a **rewrite in place**, and blocks appending in order is load-bearing:
 * `findHandoff` and the report reads walk newest-first and need a superseded
 * block to still be there.
 *
 * The target comes from **`input.state`** — the state this phase started from —
 * while the block serialized is the state it produced, and that one-comment lag
 * is what makes the two-pass restore terminate. `readThread` learns which second
 * thread to read from a block on the issue, so *something* on the issue has to
 * name the pull request; addressing this write with the new state would post the
 * very block that first records `prNumber` to the pull request it names, leaving
 * the issue with no block that has ever heard of it and the scan with no way in.
 * The lag costs exactly one comment: the delivery lands on the issue, which is
 * also where a reader wants it — it is the handover — and every comment after it
 * lands on the pull request.
 */
export const postAndAppend = async (
  thread: readonly IssueComment[],
  input: PhaseInput,
  body: string,
  state: AgentState,
  blocks?: readonly string[],
): Promise<IssueComment[]> => {
  const artifacts = blocks === undefined || blocks.length === 0 ? '' : `\n\n${blocks.join('\n\n')}`
  const rendered = `${renderStateComment(`${body}${commandPointer(state)}`, state)}${artifacts}`

  const posted = await input.deps.github.createComment(feedbackTarget(input.state), rendered)
  // The recorded author, not the one the pipeline believes in: if they differ,
  // the in-job mirror would otherwise disagree with what a later job reads back.
  reportIdentityDrift(await input.deps.selfLogin(), posted.authorLogin, input.deps.log)

  return [...thread, { id: posted.id, body: rendered, authorLogin: posted.authorLogin }]
}

/**
 * Posts a reply to the surface the question was typed on.
 *
 * A question is the one thing this pipeline says that is *not* about the state
 * of the work: it moves no phase, spends no attempt and produces no artefact, so
 * it belongs in the conversation it answers rather than in the record. Typed on
 * the issue it goes to the issue, exactly as before; typed on a pull request it
 * goes there, where the person who asked is looking.
 *
 * Three things this must not do, and the shape follows from them.
 *
 * It must not write a **state block** at all. Not because of where the block
 * would land — under D4 `postAndAppend` puts blocks on the pull request quite
 * safely, and `readThread` reads them back — but because an answer is not a
 * record: appending a block for it would add a comment to the newest-first walk
 * that says nothing happened. So this is a plain comment plus
 * {@link persistState}, the write that rewrites the newest block *in place* and
 * posts nothing. The spend is the one thing a question really does change, and
 * it is still recorded.
 *
 * It must not post **twice**. A copy on the issue "for the record" would be two
 * accounts of one exchange, free to disagree, on a page nobody asked anything on.
 *
 * And it must not swallow a **failed post**: the answer is the work here, so a
 * rejected `createComment` throws exactly as it does on the issue path, leaving
 * `reported` unset and the workflow's fallback comment in scope. Only the state
 * rewrite beside it is best-effort, for the reason `persistState` states.
 *
 * The branch stays on the **trigger** rather than on `feedbackTarget`, though
 * under D4 the two now agree: a question can only reach here from the issue while
 * there is no pull request, since `commandSurface` refuses issue commands once
 * there is one. Keeping it on the trigger says the thing this function is
 * actually for — reply where the question was asked — instead of deriving it from
 * a rule two modules away that would have to keep agreeing for ever.
 */
export const postAnswer = async (
  thread: readonly IssueComment[],
  input: PhaseInput,
  body: string,
  state: AgentState,
): Promise<readonly IssueComment[]> => {
  if (input.trigger.kind !== 'pull-request') return postAndAppend(thread, input, body, state)

  await input.deps.github.createComment(input.trigger.prNumber, body)
  await persistState(input.deps, thread, state)
  return thread
}
