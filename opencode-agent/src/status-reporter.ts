// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { PipelineConfig } from './config.js'
import { feedbackTarget } from './feedback-target.js'
import type { GitHubApi, PostedComment } from './github.js'
import { reportIdentityDrift } from './identity.js'
import type { Logger } from './logger.js'
import { renderStatus } from './status-comment.js'
import type { ReportSection, StatusView } from './status-comment.js'
import { errorMessage } from './types.js'
import type { AgentState } from './types.js'

/**
 * The run's reply: collected while the work happens, posted once when it ends.
 *
 * This was the *live status comment* — opened before the work, edited as the run
 * moved, finalised at the end — beside a second comment per phase carrying the
 * report. One maintainer command therefore drew three comments (issue #281), and
 * the first two routinely said the same thing twice. Both are now this, and a
 * command draws exactly one reply.
 *
 * **A post, not an edit**, and that is the decision the shape follows from.
 * GitHub does not notify on an edit, so a comment opened at the start and
 * rewritten at the end announces itself when the run *begins* and delivers the
 * answer in silence. Buying the notification costs the live view — a run in
 * flight is visible through the 👀 reaction, the `agent:working` label and the
 * heartbeat's once-a-minute line in the Actions log, and nothing on the thread.
 *
 * **Feedback must never fail a run**, with one narrowing. {@link attempt} is
 * still the only place this module touches GitHub and it still swallows
 * everything. But this write is no longer decoration — it is the report — so a
 * swallowed failure must leave {@link ReplyBuffer.flush} answering `null`, and
 * the caller must leave `RunResult.reported` false. A report GitHub refused is a
 * report the issue does not carry, and claiming otherwise suppresses the
 * workflow's fallback comment, which is the only thing that would explain the
 * silence.
 *
 * {@link ReplyBuffer.section} is synchronous and cannot fail: it appends to an
 * array. Everything that made the live channel expensive — the edit
 * rate-limiter, the unchanged-body suppression, the comment id held across a
 * run, the clock — went with the edits.
 */

export interface StatusReporter {
  /**
   * Records the state the run entered on, which fixes the surface for the whole
   * run.
   *
   * This is what makes the one-comment lag structural rather than a rule each
   * caller has to remember: `feedbackTarget` is resolved from a state captured
   * before any phase ran, so the block that first records `prNumber` lands on
   * the issue — which is where a reader wants the handover anyway — and every
   * later run posts to the pull request.
   */
  begin(state: AgentState): void
  /** Adds a phase's report. Terminal by construction: never re-rendered. */
  section(state: AgentState, section: ReportSection): void
  /**
   * Posts the run's one comment, or `null` when there was nothing to say and
   * when GitHub refused it. The only write this module makes.
   */
  flush(): Promise<PostedComment | null>
}

export interface StatusDeps {
  /** Narrower than `PhaseDeps`, the way `ReactionDeps` and `LabelDeps` are. */
  github: Pick<GitHubApi, 'createComment'>
  log: Logger
  config: PipelineConfig
  /** Who the pipeline believes it is, checked against who GitHub recorded. */
  selfLogin: () => Promise<string>
}

/** Everything one run's reply remembers. */
interface Reply {
  deps: StatusDeps
  startedMs: number
  /** The state the run entered on. `null` until {@link StatusReporter.begin}. */
  entry: AgentState | null
  /** The newest state a section was written from — the one the header wears. */
  latest: AgentState | null
  sections: ReportSection[]
}

/** The only place this module talks to GitHub, and so the only place it can fail. */
const attempt = async <T>(reply: Reply, action: () => Promise<T>, message: string): Promise<T | null> => {
  try {
    return await action()
  } catch (error) {
    reply.deps.log.warn(
      { issue: reply.entry === null ? null : reply.entry.issueId, error: errorMessage(error) },
      message,
    )
    return null
  }
}

const viewOf = (reply: Reply, state: AgentState): StatusView => ({
  state,
  sections: reply.sections,
  progress: null,
  live: false,
  runUrl: reply.deps.config.runUrl,
  startedMs: reply.startedMs,
  carriedTokens: 0,
  config: reply.deps.config,
})

/**
 * Posts the reply.
 *
 * An empty buffer posts nothing, which is the whole of "a run that does nothing
 * says nothing": a guardrail denial, a `/cancel` that settles without a handler,
 * and the classifier's `none` branch all reach here with no sections, and none of
 * them should put a comment on the issue. The state spend those runs still owe is
 * written by `state-persist.ts`, which rewrites a block in place and posts
 * nothing.
 */
const post = async (reply: Reply): Promise<PostedComment | null> => {
  const entry = reply.entry
  const state = reply.latest ?? entry
  if (entry === null || state === null || reply.sections.length === 0) return null

  const posted = await attempt(
    reply,
    () => reply.deps.github.createComment(feedbackTarget(entry), renderStatus(viewOf(reply, state))),
    'Could not post the run’s reply; the workflow’s fallback comment is now in scope',
  )
  if (posted === null) return null

  // The recorded author against the one the pipeline believes in. This used to
  // sit on every phase's post, where a drift surfaced on the *first* comment of
  // a run and the in-job thread mirror could be corrected with the real author.
  // One comment per run means there is no posted author to learn until here, so
  // the check moved to the only place that has one — see the change's Risks.
  reportIdentityDrift(await reply.deps.selfLogin(), posted.authorLogin, reply.deps.log)
  return posted
}

/**
 * A reporter that says nothing.
 *
 * Used by every test that is not about this channel. Note what no longer
 * qualifies: a run with no `runUrl` — a local `--event-path` run — used to get
 * this, because a status comment that cannot link the job doing the work was
 * most of the value gone. It now carries the report, so silencing it would
 * silence the run entirely; `run-detail.ts` omits the job line instead.
 */
export const noopStatusReporter = (): StatusReporter => ({
  begin: (): void => undefined,
  section: (): void => undefined,
  flush: (): Promise<PostedComment | null> => Promise.resolve(null),
})

export const createStatusReporter = (deps: StatusDeps, startedMs: number): StatusReporter => {
  const reply: Reply = { deps, startedMs, entry: null, latest: null, sections: [] }

  return {
    begin: (state): void => {
      reply.entry = state
      // Cleared rather than assumed empty, so the contract is "one run at a
      // time" rather than "construct one per run and hope". A process drives
      // exactly one run, so in production this clears nothing — but a buffer
      // that quietly kept a finished run's sections would post them again under
      // the next run's heading, which is a trap worth two lines to close.
      reply.latest = null
      reply.sections = []
    },
    section: (state, section): void => {
      reply.latest = state
      reply.sections.push(section)
    },
    flush: (): Promise<PostedComment | null> => post(reply),
  }
}
