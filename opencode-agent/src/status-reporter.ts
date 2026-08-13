// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { PipelineConfig } from './config.js'
import { feedbackTarget } from './feedback-target.js'
import type { GitHubApi } from './github.js'
import type { Logger } from './logger.js'
import type { ProgressSnapshot } from './progress.js'
import type { RunResult } from './run-result.js'
import { renderStatus } from './status-comment.js'
import type { StatusView } from './status-comment.js'
import { errorMessage } from './types.js'
import type { AgentState } from './types.js'

/**
 * The live status channel: one comment per run, opened when the run starts,
 * edited as it moves, finalised when it ends.
 *
 * The same two rules the reaction and label channels are built on, for the same
 * reasons.
 *
 * **Feedback must never fail a run.** Every write here is decoration on work
 * that matters, and each is a new way to break a pipeline that used to work — a
 * token without `issues: write`, a fork run, a secondary rate limit. So
 * {@link attempt} is the only place this module touches GitHub and it swallows
 * everything: a failed edit is a `warn`, and a failed *create* leaves
 * `commentId` null so every later call is a no-op and the run degrades to
 * exactly the behaviour it had before this channel existed.
 *
 * **A status comment is not a report.** `RunResult.reported` means the issue
 * carries this run's account of what happened, and the workflow's fallback
 * comment is gated on it. A run killed mid-phase leaves "run in progress" on the
 * issue — which is *precisely* the case that fallback exists for — so marking it
 * reported would suppress the one comment that would have explained the silence.
 * {@link StatusReporter.finish} therefore takes the result and returns nothing:
 * the flag is unreachable from here, rather than merely left alone by habit.
 *
 * Cost is bounded twice over, because a status comment is the only sustained
 * writer this pipeline has: an edit is skipped when the rendered body has not
 * changed, and otherwise at most one is issued per minute. A 90-minute run costs
 * ~90 edits, comfortably inside the secondary rate limit on content-mutating
 * requests, and a quiet stretch costs nothing at all. The clock is injected, so
 * neither bound is proved by waiting.
 */

export interface StatusReporter {
  /** Opens the comment. Called once, and only when a run is about to do work. */
  start(state: AgentState): Promise<void>
  /** The cascade is about to run a handler for this state. */
  enter(state: AgentState): Promise<void>
  /** A heartbeat's account of the turn in flight. */
  tick(snapshot: ProgressSnapshot): Promise<void>
  /** The run is over. Returns nothing, deliberately — see the note above. */
  finish(result: RunResult): Promise<void>
}

export interface StatusDeps {
  /** Narrower than `PhaseDeps`, the way `ReactionDeps` and `LabelDeps` are. */
  github: Pick<GitHubApi, 'createComment' | 'updateComment'>
  log: Logger
  config: PipelineConfig
  /**
   * The clock, injected.
   *
   * Nothing in this module reads `Date.now()`: the rate limit is the property
   * most worth testing here and the least affordable to test by waiting a
   * minute for it.
   */
  now: () => number
}

/** At most one edit a minute, whatever happens in between. */
export const MIN_EDIT_INTERVAL_MS = 60_000

/**
 * Everything one run's status comment remembers.
 *
 * A record passed to module-level functions rather than a closure over a dozen
 * `let`s: the same fields, and the file stays readable at the length the rules
 * above cost to state.
 */
interface RunStatus {
  deps: StatusDeps
  runUrl: string
  startedMs: number
  /** `null` until the comment exists, and for ever if opening it failed. */
  commentId: number | null
  state: AgentState | null
  /** What the issue had spent before this job started. Captured once. */
  carriedTokens: number
  progress: ProgressSnapshot | null
  live: boolean
  /** The body GitHub currently holds, so an unchanged render costs nothing. */
  lastBody: string | null
  lastEditMs: number
}

/** The only place this module talks to GitHub, and so the only place it can fail. */
const attempt = async <T>(run: RunStatus, action: () => Promise<T>, message: string): Promise<T | null> => {
  try {
    return await action()
  } catch (error) {
    run.deps.log.warn({ issue: run.state === null ? null : run.state.issueId, error: errorMessage(error) }, message)
    return null
  }
}

const viewOf = (run: RunStatus, state: AgentState): StatusView => ({
  state,
  progress: run.progress,
  live: run.live,
  runUrl: run.runUrl,
  startedMs: run.startedMs,
  carriedTokens: run.carriedTokens,
  config: run.deps.config,
})

/**
 * Edits the comment, subject to both bounds.
 *
 * `force` skips the clock, never the unchanged-body check, and exactly one
 * caller passes it: the final edit. A tick dropped inside the window is picked
 * up by the next one a minute later, and a phase move dropped by it is picked up
 * the same way — but a run that ends inside the window would otherwise leave
 * "run in progress" on the issue for ever, which is the one state this comment
 * must never be left in by an ordinary exit.
 */
const publish = async (run: RunStatus, force: boolean): Promise<void> => {
  const id = run.commentId
  const state = run.state
  if (id === null || state === null) return

  const body = renderStatus(viewOf(run, state))
  if (body === run.lastBody) return
  if (!force && run.deps.now() - run.lastEditMs < MIN_EDIT_INTERVAL_MS) return

  // Stamped before the call, not after it: a refused edit has still spent the
  // request the bound is protecting, and retrying it every tick is how a
  // rate-limited run stays rate-limited.
  run.lastEditMs = run.deps.now()
  const written = await attempt(
    run,
    async () => {
      await run.deps.github.updateComment(id, body)
      return body
    },
    'Could not update the status comment',
  )
  // Only what GitHub accepted, so a failed edit is retried rather than believed.
  if (written !== null) run.lastBody = written
}

/**
 * Opens the comment for a run.
 *
 * Everything a previous run left behind is cleared here rather than assumed
 * absent, so the contract is "one run at a time" rather than "construct one per
 * run and hope". A process drives exactly one run, so in production this clears
 * nothing — but a reporter that quietly stayed finished, and so rendered its
 * second run's opening comment as though it had already ended, is a trap worth
 * four lines to close. `startedMs` is deliberately not among them: the job
 * started when the process did, which is what the comment's first line claims.
 */
const open = async (run: RunStatus, state: AgentState): Promise<void> => {
  run.state = state
  run.carriedTokens = state.tokensSpent
  run.commentId = null
  run.lastBody = null
  run.lastEditMs = 0
  run.progress = null
  run.live = true

  const body = renderStatus(viewOf(run, state))
  // The pull request once one exists — see `feedback-target.ts`. This is the one
  // comment in the pipeline that is *about the run happening now* rather than
  // about the issue, and once there is a diff, the page somebody is watching
  // while it happens is the pull request. The report and the state block stay on
  // the issue either way: they are the record, and the restore scan reads exactly
  // one thread.
  const posted = await attempt(
    run,
    () => run.deps.github.createComment(feedbackTarget(state), body),
    'Could not open the status comment; this run reports only when it ends',
  )
  if (posted === null) return

  run.commentId = posted.id
  run.lastBody = body
  run.lastEditMs = run.deps.now()
}

const finalise = async (run: RunStatus, result: RunResult): Promise<void> => {
  run.live = false
  // A guardrail skip carries no state, and no status comment was opened for one
  // either — but a halted run does carry the state it halted on, and that is the
  // state the comment should end on.
  if (result.state !== null) run.state = result.state
  await publish(run, true)
}

/**
 * A reporter that says nothing.
 *
 * Used by every test that is not about this channel, and by local
 * `--event-path` runs, which have no run to link to: the comment's first line is
 * a link to the job doing the work, and a status comment that cannot say where
 * the work is happening is most of the value gone. That decision lives in
 * {@link createStatusReporter}, so no caller has to make it twice.
 */
export const noopStatusReporter = (): StatusReporter => ({
  start: (): Promise<void> => Promise.resolve(),
  enter: (): Promise<void> => Promise.resolve(),
  tick: (): Promise<void> => Promise.resolve(),
  finish: (): Promise<void> => Promise.resolve(),
})

export const createStatusReporter = (deps: StatusDeps): StatusReporter => {
  const runUrl = deps.config.runUrl
  if (runUrl === null) return noopStatusReporter()

  const run: RunStatus = {
    deps,
    runUrl,
    startedMs: deps.now(),
    commentId: null,
    state: null,
    carriedTokens: 0,
    progress: null,
    live: true,
    lastBody: null,
    lastEditMs: 0,
  }

  return {
    start: (state): Promise<void> => open(run, state),
    enter: async (state): Promise<void> => {
      run.state = state
      await publish(run, false)
    },
    tick: async (snapshot): Promise<void> => {
      run.progress = snapshot
      await publish(run, false)
    },
    finish: (result): Promise<void> => finalise(run, result),
  }
}
