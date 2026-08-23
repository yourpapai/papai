// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { PipelineError } from './errors.js'
import type { ProgressSnapshot } from './progress.js'
import type { TurnStall } from './turn-stall.js'

/**
 * How a turn ends badly: the four failures a phase can branch on.
 *
 * Split from `errors.ts` when the stall bound pushed that file past
 * `max-lines`, along the seam its own header already names — almost every
 * failure there ends the same way (the orchestrator parks the run and posts
 * the message), while these four are the exceptions a **handler** reads by
 * `code` to decide what may be salvaged. They change for the same reason —
 * when the pipeline learns something new about how a turn dies — which is a
 * different reason than the work breaking.
 *
 * `errors.ts` re-exports all of it, so callers keep naming one module; the
 * same arrangement `config-clock-values.ts` has.
 */

/** The one code a handler branches on rather than merely logs: the turn's own clock. */
const TURN_DEADLINE = 'TURN_DEADLINE'

/**
 * A model turn stopped by its own bound, said in a way the phase can act on and a
 * reader can believe.
 *
 * The message this replaces was `The model did not answer within 1800000ms`, about
 * a turn that answered **355 times** at roughly twelve tool calls a minute and was
 * cut off mid-`bash`. That wording describes a hang, so it sent whoever read it
 * looking for one and gave them a healthy turn and no explanation. What is true is
 * that the turn was working and ran out of clock, and the numbers saying so were
 * already in hand — the heartbeat had been printing them once a minute.
 *
 * Distinguishable by code because the consequence differs, which is the whole
 * finding: every other rejection out of a prompt means the work broke and belongs
 * in `failRun` as ❌ with an attempt spent, and this one means a ceiling was
 * reached in a run where nothing broke — so it salvages the tree, parks in
 * `INCOMPLETE` and spends nothing.
 */
export const turnDeadlineError = (elapsedMs: number, progress: ProgressSnapshot): PipelineError =>
  new PipelineError(
    TURN_DEADLINE,
    `The turn ran out of time after ${elapsedMs}ms and was stopped part-way through: ` +
      `${progress.toolCalls} tool calls, ${progress.tokens.toLocaleString('en-US')} tokens, ` +
      `last action "${progress.lastAction}". The bound is \`AGENT_TIMEOUT_MS\`, shrunk to fit what was left of ` +
      "the job's own deadline.",
    progress,
  )

/**
 * Whether a rejection is that stop.
 *
 * A predicate here rather than a `code` comparison at the call site, for the reason
 * `isPullRequestCreationForbidden` is one: the tag is this module's business,
 * and a handler spelling it out is a second copy of a string that has to agree.
 */
export const isTurnDeadline = (error: unknown): error is PipelineError =>
  error instanceof PipelineError && error.code === TURN_DEADLINE

/** The other failure a reader cannot diagnose from its message alone. */
const SERVER_GONE = 'OPENCODE_SERVER_GONE'

/**
 * A turn whose OpenCode server stopped answering, named rather than quoted.
 *
 * Issue #239 failed twice with `The socket connection was closed unexpectedly`,
 * which is Bun's wording for a `fetch` whose peer went away and names neither
 * end of it. Every reader starts at the model provider, because that is the only
 * remote a model turn obviously has. It was the `opencode serve` **this job
 * spawned** — established only afterwards, and only by inference: the
 * `session.get` that `tokensUsed()` makes next failed too, and that call is a
 * loopback request no provider is on the path of. So the evidence was in hand at
 * the moment of failure and thrown away, and the run reported the one sentence
 * that sends you the wrong way.
 *
 * This asks the question instead of leaving it to be reconstructed from two log
 * lines a week later. The transport's own message is kept, because it is the only
 * account of *how* the socket went; what is added is which socket it was, and
 * where to look for the cause — the post-mortem step, which reports an
 * out-of-memory kill and a second `opencode` process precisely because neither is
 * visible from here.
 *
 * Distinguishable by code for the reason {@link turnDeadlineError} is, and it is
 * checked **after** that one: a deadline is a ceiling the phase salvages work for,
 * and a turn cut off by its own bound must keep meaning that even when the probe
 * that runs afterwards finds the server gone too.
 */
export const serverGoneError = (transport: string): PipelineError =>
  new PipelineError(
    SERVER_GONE,
    'The local OpenCode server stopped answering mid-turn, so this turn ended with nothing to show for it. ' +
      `The transport reported: ${transport}. That is the \`opencode serve\` this job spawned on loopback — ` +
      'not the model provider — so look at the run’s post-mortem step for an out-of-memory kill or for a ' +
      'second `opencode` process the model started from `bash`.',
  )

/** Whether a rejection is that death. */
export const isServerGone = (error: unknown): error is PipelineError =>
  error instanceof PipelineError && error.code === SERVER_GONE

/** The third code a handler branches on: the provider stopped serving the turn. */
const TURN_STALL = 'TURN_STALL'

/**
 * A turn aborted mid-flight because the provider stopped serving it, said in a
 * way a reader can tell from the whole-turn deadline.
 *
 * The incident this exists for: the gateway answered HTTP 200 and streamed
 * nothing, the session retried the identical request 78 times over 57 minutes,
 * and nothing in the pipeline stopped the turn until `AGENT_TIMEOUT_MS` killed
 * it at 90 — a dead spiral never self-heals, and a sibling run recovering from
 * every brief episode in the same window is the proof that the difference is
 * *time without progress*. The stall bound aborts the turn once
 * `AGENT_STALL_TIMEOUT_MS` has passed with no finished step and no new tool
 * call **while** retries or session errors accumulate — both conditions,
 * because the retry evidence is what separates a provider wave from one very
 * long generation.
 *
 * Like {@link turnDeadlineError} it carries the `ProgressSnapshot`: the turn
 * may hold partial work worth salvaging, and "what had it managed" is the
 * first question a maintainer asks. Unlike it, the remedy is not a bigger
 * window — a stall clears with time, so the notice says what stalled, names
 * `AGENT_STALL_TIMEOUT_MS` and never `AGENT_TIMEOUT_MS`, and invites the
 * `/retry` that resumes from the same phase once it has.
 *
 * **Who it blames is decided by {@link refusalClause}, not by the header.** It
 * used to open "The provider stalled this turn" and assert that the provider
 * kept failing the request, unconditionally — a claim the record often cannot
 * support, because `retries` and `failure` are independent and only the second
 * is evidence about the remote. The 2026-08-22 runs are the cost: retries
 * accumulated, `session.error` never fired, and every reader was sent to the
 * model provider by a message stating it as fact. The provider was healthy —
 * this job's own loopback proxy was closing the socket on Bun's ten-second idle
 * bound (`provider-proxy.ts`, now `idleTimeout: 0`). The bug is fixed and the
 * wording still matters: the proxy is a permanent hop, so "a retry with no
 * status" will always have two ends it could have come from.
 */
export const turnStallError = (windowMs: number, stall: TurnStall, progress: ProgressSnapshot): PipelineError =>
  new PipelineError(
    TURN_STALL,
    `This turn stalled: for the last ${windowMs}ms it produced no finished step and started ` +
      `no new tool call, while ${refusalClause(stall)}. ` +
      `The turn had managed ${progress.toolCalls} tool calls, ${progress.tokens.toLocaleString('en-US')} tokens, ` +
      `last action "${progress.lastAction}". This is a stall, not the whole-turn deadline: finished work is safe ` +
      'on the branch, and a stall usually clears with time — reply `/retry` when it has. ' +
      'The window is `AGENT_STALL_TIMEOUT_MS`.',
    progress,
  )

/**
 * What refused the request, said only as far as the record actually goes.
 *
 * A `session.error` carries a name and a status, which is the provider
 * answering for itself — there, naming it is honest. Retries alone are not:
 * OpenCode retries a request whose socket went away exactly as it retries a
 * 429, so a retry with no status says only that the call kept failing, and the
 * path it failed on has two hops. Naming both is what the evidence supports,
 * and it is the difference between a maintainer checking the run log and a
 * maintainer waiting out a provider outage that is not happening.
 */
const refusalClause = (stall: TurnStall): string =>
  stall.failure === null
    ? `the session retried the request ${plural(stall.retries, 'time')} and the provider published no error of ` +
      'its own, so what refused it is not established here — the model endpoint is this job’s loopback proxy in ' +
      'front of the real one, and a retry carrying no status can come from either hop'
    : `the provider kept failing the request${retriesClause(stall.retries)}${failureClause(stall.failure)}`

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`

/** Whether a rejection is that abort. */
export const isTurnStall = (error: unknown): error is PipelineError =>
  error instanceof PipelineError && error.code === TURN_STALL

/**
 * A turn the model never answered, because the provider was still refusing it.
 *
 * The failure issue #239 had no name for, and the one that cost the most: the
 * session retried the model call twenty-five times over twelve minutes, went
 * idle without finishing another step, and the prompt returned a perfectly
 * ordinary envelope carrying no text. Every layer downstream read that as a
 * finished turn — `decodeReply` checks the transport's `error` field and this
 * failure is not in it, and the implement phase discards the reply — so the
 * phase committed a working tree holding one stray pid file, opened a pull
 * request and reported the plan implemented.
 *
 * Raised as an ordinary failure and **not** as a ceiling: it is neither of the
 * two stops that salvage. There is nothing to salvage, since a turn the model
 * never answered wrote nothing, and the remedy is a `/retry` — which is exactly
 * right for the cause this shape usually has. A rate limit or a spent
 * subscription window clears with time, and the run parks in `FAILED` with its
 * resume point intact until somebody says go again.
 *
 * The count and the status code are the message, because they are what tells a
 * maintainer which wait they are in for: twenty-five retries and a 429 is a
 * quota to wait out, one failure and a 401 is a credential to fix.
 */
export const providerStalledError = (stall: TurnStall): PipelineError =>
  new PipelineError(
    'PROVIDER_STALLED',
    'The model never answered this turn: the provider was still failing when the session gave up' +
      retriesClause(stall.retries) +
      failureClause(stall.failure) +
      '. Nothing was written, so nothing is lost — but the turn has to fail here rather than commit whatever the ' +
      'tree happened to hold, which is how a run with no deliverable once delivered a pull request. ' +
      'A quota or rate limit clears with time: reply `/retry` when it has.',
  )

const retriesClause = (retries: number): string => (retries === 0 ? '' : ` after ${retries} retries`)

const failureClause = (failure: TurnStall['failure']): string => {
  if (failure === null) return ''
  return failure.statusCode === null ? ` (${failure.name})` : ` (${failure.name} ${failure.statusCode})`
}
