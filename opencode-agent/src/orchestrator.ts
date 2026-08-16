// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { IssueComment } from './blocks.js'
import { driveMachine, hasHandler } from './cascade.js'
import { parseSlashCommand } from './commands.js'
import type { ParsedCommand } from './commands.js'
import { unreachable } from './errors.js'
import { react, settleReaction } from './feedback.js'
import { evaluateGuardrails } from './guardrails.js'
import { reconcileLabels, settleLabels } from './labels.js'
import type { IssueContext, PhaseDeps, PhaseInput } from './phase-context.js'
import type { RunResult } from './run-result.js'
import { findLatestState, initialState } from './state-manager.js'
import type { TriggerEvent } from './trigger-events.js'
import type { TriggerOutcome } from './trigger-outcome.js'
import { applyTrigger } from './triggers.js'
import type { AgentState } from './types.js'

export interface RunOptions {
  event: TriggerEvent
  deps: PhaseDeps
}

/**
 * One CI job = one call. Restores state from the issue thread, turns the
 * trigger into a state move, then runs phase handlers back-to-back until the
 * machine reaches a waiting state, COMPLETE, or a failure.
 */
export const runPipeline = async (options: RunOptions): Promise<RunResult> => {
  const { event, deps } = options

  const guard = evaluateGuardrails(event, {
    selfLogin: await deps.selfLogin(),
    selfWorkflowName: deps.config.selfWorkflowName,
  })
  if (!guard.allowed) {
    deps.log.warn({ code: guard.code, event: event.eventName }, 'Trigger rejected by guardrails')
    // The one denial with a person behind it. Every other code here is machine
    // noise — a bot, the agent's own comment, a pull request, an event shape
    // this pipeline does not handle — and reacting to those would be talking to
    // nobody. `NOT_MAINTAINER` is a write triggered by an account without write
    // access, which is the judgement call: it is bounded to one reaction on one
    // comment with no content and no notification storm, and the alternative is
    // that an outside contributor's comment vanishes into a log they cannot
    // read.
    if (guard.code === 'NOT_MAINTAINER') await react(deps, event, 'confused')
    // `reported: false` and it has to stay that way: a reaction is not an
    // account of what happened, so the issue still carries nothing about this
    // run and the workflow's fallback comment must stay in scope.
    return { status: 'skipped', reason: guard.reason, state: null, reported: false }
  }

  // Every accepted trigger, before anything else this run does — a reaction that
  // arrives after the work is worth much less than one that arrives before it,
  // and this is the only acknowledgement any trigger gets. CI events fall
  // through it silently; `reactionTarget` decides that, not this call site.
  const acknowledgement = await react(deps, event, 'eyes')

  const result = await runAccepted(event, deps)

  // The other end of that acknowledgement, and the reason it is held here rather
  // than inside `runAccepted`: 👀 is placed before the run knows which of its
  // several exits it will take, so the only place guaranteed to see both the
  // handle and the outcome is the one frame that spans them. Every exit below is
  // an ordinary `return`, so there is no path that skips it — a throw is the
  // deliberate exception, and it is the crash the workflow's fallback comment
  // exists to explain, where a stale 👀 is the least of what is left behind.
  //
  // Not reporting, for the reason `finish` is not: an emoji is not an account of
  // what happened, so `result.reported` is passed through untouched.
  await settleReaction(deps, event, acknowledgement, result.status)

  return result
}

/** The conversation this run reads, and the state restored out of it. */
interface RestoredThread {
  thread: readonly IssueComment[]
  restored: AgentState
}

/**
 * Reads the conversation, in two passes once there is a pull request to read.
 *
 * Design D4 moved every comment onto the pull request the moment one exists, and
 * this is the half that keeps that safe. `findLatestState` scans one list, so a
 * block written to the pull request is invisible to a scan of the issue — which
 * is precisely why the record could not move before.
 *
 * The **issue is read first, always**, and that ordering is what makes the second
 * pass possible rather than circular: `prNumber` is itself a field of a state
 * block, so the only way to learn which second thread to read is to restore from
 * the thread that needs no lookup. The issue always carries blocks from before
 * the pull request existed — capture, design, planning and the delivery that
 * first recorded `prNumber` all happen while there is nothing else to write to —
 * so the first pass can always bootstrap the second.
 *
 * The merge is **issue then pull request**, by construction rather than by
 * timestamp. Blocks are appended in order within a thread, and every block on the
 * pull request was written after the last one on the issue, because the write
 * moves there the moment `prNumber` is set and never moves back. Walking the
 * concatenation newest-first therefore walks real time. It also fails in the
 * safe direction: a block someone hand-edited onto the issue after delivery
 * loses to the machine's own newer one, rather than overriding it.
 *
 * One extra read, and only after a pull request exists. A thread that names none
 * behaves exactly as it did before, which is what leaves in-flight issues
 * unstranded and makes the change need no `STATE_VERSION` bump.
 */
const readThread = async (event: TriggerEvent, deps: PhaseDeps): Promise<RestoredThread> => {
  const login = await deps.selfLogin()
  const issueThread = await deps.github.listIssueComments(event.issueNumber)
  const fromIssue = findLatestState(issueThread, login, event.issueNumber)
  if (fromIssue === null) return { thread: issueThread, restored: initialState(event.issueNumber) }
  const prNumber = fromIssue.prNumber
  if (prNumber === null) return { thread: issueThread, restored: fromIssue }

  const thread = [...issueThread, ...(await deps.github.listIssueComments(prNumber))]
  return { thread, restored: findLatestState(thread, login, event.issueNumber) ?? fromIssue }
}

/**
 * Everything a trigger the guardrails let through does.
 *
 * Split from {@link runPipeline}, which is now the guardrail and the
 * acknowledgement, because the two halves answer different questions and the
 * function was already at the length limit before the label reconciles arrived.
 *
 * Both of those reconciles live here rather than deeper down, because both are
 * statements about the *run*: one marker goes on when work starts and comes off
 * when it ends, whatever the outcome, and neither fact is known to a phase.
 */
const runAccepted = async (event: TriggerEvent, deps: PhaseDeps): Promise<RunResult> => {
  const { thread, restored } = await readThread(event, deps)
  const issue = await resolveIssue(event, deps)
  const command = triggerCommand(event)

  const base: PhaseInput = { state: restored, issue, trigger: event, command, thread, deps }

  // Before `applyTrigger`, not before the cascade: a refused command — an
  // exhausted `/retry`, a `/review` past its ceiling, a command typed on the
  // wrong surface — is buffered by the trigger layer, and a `begin` that waited
  // for the cascade would leave those sections in a buffer nothing ever flushed.
  // It is also the state the run entered on, which is what fixes the surface for
  // the whole run. It writes nothing.
  deps.status.begin(restored)

  return flushAround(deps, async () => {
    const entry = await applyTrigger(base)
    if (entry.halt !== null) return settleLabels(deps, entry.halt, restored)

    // Only when something is actually going to run. The closing reconcile
    // happens either way — it is also the repair — but marking a run that is
    // about to do nothing adds the marker and takes it off again within the
    // second, which is two timeline entries on an issue where the agent did
    // nothing, and precisely the churn a diff instead of a clear-and-reapply
    // exists to avoid.
    //
    // The reply used to be opened on this same condition, and needs no gate at
    // all now that it is posted at the end: a run that does nothing buffers no
    // sections, and a buffer with no sections posts nothing.
    if (willWork(entry)) await reconcileLabels(deps, entry.state, 'working')

    const result = await driveMachine({
      ...base,
      state: entry.state,
      answer: entry.answer,
      posted: false,
      // Captured once. This job's session total is cumulative across the phases
      // it runs, so adding it to the *restored* figure gives a monotonic total;
      // adding it to each phase's own would count the earlier phases again.
      carriedTokens: restored.tokensSpent,
    })

    return settleLabels(deps, result, entry.state)
  })
}

/**
 * Runs the whole accepted run and posts its reply, whichever way it leaves.
 *
 * The `finally` is the whole point and is what bounds the cost of buffering. A
 * report used to be on the issue the moment the phase that wrote it finished;
 * held in memory until the end, a run that throws would take every section with
 * it — which would be strictly worse than what it replaced. Here a throw posts
 * what was buffered and then rethrows, so the failure still reaches `runCli`
 * and the job still goes red.
 *
 * What it cannot cover is a process that never runs its `finally`: an OOM kill,
 * a cancelled job, a runner past `timeout-minutes`. Those leave nothing on the
 * thread, and the workflow's fallback comment is the whole answer — the same
 * answer it was before this change.
 *
 * `reported` is set from what GitHub **accepted**, not from the flush having
 * been attempted: a refused post leaves the issue carrying no account of the
 * run, and the fallback comment must stay in scope to say so.
 */
const flushAround = async (deps: PhaseDeps, run: () => Promise<RunResult>): Promise<RunResult> => {
  try {
    const result = await run()
    const posted = await deps.status.flush()
    return posted === null ? { ...result, reported: false } : { ...result, reported: true, replyCommentId: posted.id }
  } catch (error) {
    await deps.status.flush()
    throw error
  }
}

/**
 * Whether the cascade will actually run a handler for this entry.
 *
 * The two cases where it will not are a trigger that moved into a waiting phase
 * and `/cancel`, which reaches `COMPLETE` — both of them state moves with no
 * work behind them, and `agent:working` on either is a claim that nothing is
 * happening. Asked of the same `HANDLERS` table {@link driveMachine} looks the
 * phase up in, so the marker cannot disagree with what the machine does next.
 */
const willWork = (entry: TriggerOutcome): boolean => entry.answer || hasHandler(entry.state.phase)

/**
 * The slash command this trigger carries, if a person typed one.
 *
 * Both human kinds are read, and a pull-request comment is read with the very
 * same parser: `parseSlashCommand` requires the command to start a line and
 * ignores fenced blocks, which is what makes `resolvePullRequestTrigger`'s
 * cheap `/review` filter and this second reading agree rather than merely
 * coincide.
 */
const triggerCommand = (event: TriggerEvent): ParsedCommand | null => {
  switch (event.kind) {
    case 'ci':
      return null
    case 'issue':
      return parseSlashCommand(event.commentBody)
    case 'pull-request':
      return parseSlashCommand(event.commentBody)
    case 'pr-merged':
      return null
    default:
      return unreachable(event)
  }
}

/**
 * The issue's title and body, from the payload when present, else the API.
 *
 * Only the issue kind carries them. A CI run names a branch and nothing else,
 * and a **pull-request comment carries the pull request's** title and body —
 * which is the reason that is a third kind rather than a flag on this one:
 * passed through here, every phase downstream would reason over the pull request
 * as though it were the issue, under the right field names.
 */
const resolveIssue = (event: TriggerEvent, deps: PhaseDeps): Promise<IssueContext> => {
  if (event.kind === 'issue') {
    return Promise.resolve({ number: event.issueNumber, title: event.issueTitle, body: event.issueBody })
  }
  return deps.github.getIssue(event.issueNumber)
}
