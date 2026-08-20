// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { IssueComment } from './blocks.js'
import type { PhaseInput } from './phase-context.js'
import { presentationFor } from './presentation.js'
import { serializeState } from './state-manager.js'
import { persistState } from './state-persist.js'
import type { AgentState } from './types.js'

/**
 * The two things this pipeline says to a conversation, and the one line they
 * both carry.
 *
 * Split from `run-report.ts` when the surface move (design D4) pushed that file
 * past `max-lines`, along a seam it already described in its own first sentence:
 * everything left there *renders* — a failure, a park, a refusal, a closing —
 * and this is what commits it to the reply. The two change for entirely
 * different reasons. A renderer changes when the wording does; these two change
 * when the answer to "does it carry the record" changes, which is a question
 * about the restore scan and the state machine rather than about prose.
 *
 * Neither **posts** any more. Both append a section to the run's reply buffer,
 * which `runAccepted` flushes once, as one comment, when the run settles — so a
 * maintainer's command draws exactly one reply however many phases answered it.
 * What survives the change is the distinction the two names carry:
 * `postAndAppend` is the pipeline's only durable write and the only place a
 * state block is appended, and `postAnswer` is deliberately not a record.
 *
 * The **surface** is no longer decided here at all. It was `feedbackTarget` of
 * the phase's *entry* state, a one-comment lag each caller had to not forget;
 * the buffer now resolves it once from the state the whole run entered on, which
 * is the same guarantee made structural — see `status-reporter.ts`.
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
 * How a folded section names itself.
 *
 * From the one presentation table, keyed on the state the phase *started* from,
 * so a section is titled by the work it did rather than by where that work left
 * the machine — "Breaking the spec into steps", not "Plan is waiting for you".
 * Reading it from `PRESENTATION` is what keeps a section from acquiring a name
 * no other surface uses.
 */
const sectionSummary = (input: PhaseInput): string => presentationFor(input.state, 'working').headline

/**
 * The reply as the rest of *this job* sees it.
 *
 * A later phase in the same job reads artefacts out of `thread` rather than
 * re-fetching the issue, so a buffered section still has to appear there. The id
 * is synthetic and negative because there is no real comment until the flush:
 * a negative id matches nothing GitHub would return, so code that assumed it
 * could edit this fails loudly instead of rewriting a real comment. `readBlock`
 * reads bodies and never ids, which is why the blocks still resolve normally.
 */
const MIRROR_ID = -1

const mirror = (authorLogin: string, body: string): IssueComment => ({ id: MIRROR_ID, body, authorLogin })

/**
 * Adds a phase's report to the run's reply, and mirrors it into the in-memory
 * thread so a later phase in the same job can read an artefact the earlier phase
 * just wrote without re-fetching the issue.
 *
 * The state block is appended **into the same body** as every other section's,
 * which the block layer already supports and which is what makes the whole
 * consolidation cheap: `readBlock` returns the *last* block of a marker in a
 * body and `locateLatestBlock` walks the thread newest-first, so "newest wins"
 * is unchanged whether a run wrote four comments or one. Superseded blocks stay
 * present in the body, which `findHandoff` and the report read depend on —
 * they walk newest-first and need the older ones to still be there.
 *
 * Which page it lands on is decided **once, by the buffer**, from the state the
 * run entered on. That preserves the property the old per-comment lag bought:
 * `readThread` learns which second thread to read from a block on the issue, so
 * something on the issue has to name the pull request, and a delivery addressed
 * with its *own* new state would post the very block that first records
 * `prNumber` to the pull request it names — leaving the issue with no block that
 * has ever heard of it and the restore scan with no way in.
 */
export const postAndAppend = async (
  thread: readonly IssueComment[],
  input: PhaseInput,
  body: string,
  state: AgentState,
  blocks?: readonly string[],
): Promise<IssueComment[]> => {
  const prose = `${body}${commandPointer(state)}`.trimEnd()
  const carried = [serializeState(state), ...(blocks ?? [])]
  input.deps.reply.section(state, { summary: sectionSummary(input), body: prose, blocks: carried })

  return [...thread, mirror(await input.deps.selfLogin(), `${prose}\n\n${carried.join('\n\n')}`)]
}

/**
 * Answers a question, without recording anything.
 *
 * A question is the one thing this pipeline says that is *not* about the state
 * of the work: it moves no phase, spends no attempt and produces no artefact.
 *
 * So it writes no **state block**. Not because of where a block would land, but
 * because an answer is not a record: a block appended for it would add an entry
 * to the newest-first walk that says nothing happened. What a question really
 * does change is the spend, and that is still written — by {@link persistState},
 * which rewrites the newest block of an *earlier* comment in place and posts
 * nothing.
 *
 * Its old branch on `input.trigger.kind` is gone with the write it guarded. It
 * existed to reply on the surface the question was typed on, and there is now
 * one reply per run whose surface the buffer resolves; the two always agreed in
 * any case, since `commandSurface` refuses issue commands once a pull request
 * exists.
 */
export const postAnswer = async (
  thread: readonly IssueComment[],
  input: PhaseInput,
  body: string,
  state: AgentState,
): Promise<readonly IssueComment[]> => {
  input.deps.reply.section(state, { summary: sectionSummary(input), body: body.trimEnd(), blocks: [] })
  await persistState(input.deps, thread, state)
  return thread
}
