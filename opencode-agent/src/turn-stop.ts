// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { HANDOFF_MARKER, renderArtifact } from './artifacts.js'
import { withDeadline } from './deadline.js'
import { openCodeError } from './errors.js'
import type { PipelineError } from './errors.js'
import type { OpenCodeAgent } from './opencode-adapter.js'
import type { PhaseDeps, PhaseInput, PhaseOutcome } from './phase-context.js'
import { WRAP_UP_PROMPT } from './prompts.js'
import type { SalvageOutcome } from './salvage.js'
import { salvageWork } from './salvage.js'
import { msToDeadline } from './time-budget.js'
import { renderStoppedPartWay } from './time-notices.js'
import { errorMessage } from './types.js'

/**
 * Stopping a model turn that ran out of wall clock, in three steps, and keeping
 * what it had done.
 *
 * The budget is spent in three slices — work, wrap-up, teardown — and this module is
 * the last two. One hard stop is not enough on its own: the model is most likely to
 * be **mid-file** when the clock runs out, and a tree with one half-written module in
 * it is worth much less than the same tree with that module finished. So the stop
 * asks once, briefly, and then stops asking.
 *
 * Two facts, both measured against a live `opencode-ai@1.18.7`, decide the shape:
 * `POST /session/:id/abort` kills the running tool child and leaves the server up,
 * while `close()` — one SIGTERM to one pid on POSIX — kills the server and leaves the
 * tool child running, reparented to init. **`abort` is the stop; `close()` is the
 * leak.** Nothing here may treat the second as a fallback for the first, and nothing
 * here closes anything: teardown belongs to `runCli`, and see {@link stopPartWayThrough}
 * for the ordering that depends on the server still being up when this returns.
 */

export interface PartWayInput {
  input: PhaseInput
  /** Branch the salvage commits onto — already checked out by the handler. */
  branch: string
  /** The typed deadline failure, carrying what the turn had managed. */
  stopped: PipelineError
  /**
   * The system prompt the interrupted turn ran under, reused verbatim.
   *
   * Passed in rather than rebuilt, because rebuilding it would mint a second
   * envelope: the nonce in a system prompt has to be the one the user prompt's
   * delimiters carry, and `mintEnvelope` is called once per handler for exactly that
   * reason. A fresh nonce here would tell the model to trust an id that appears
   * nowhere, which makes every real delimiter in the session look forged.
   */
  system: string
}

/**
 * Soft stop, hard stop, teardown — and the phase outcome that parks the issue.
 *
 * **Ordering constraint that is a silent bug if missed**: nothing in this function
 * closes the session, and it must stay that way. `tokensUsed()` degrades to `0` with
 * a `warn` when the server cannot answer, and the spend is recorded *after* a handler
 * returns, by `recordSpend` in the cascade. A stop that tore the server down on its
 * way out would therefore persist a total with this whole job missing from it — and
 * `INCOMPLETE` is precisely the state a `/continue` comes back out of, so that total
 * is the one the next job hands to the token ceiling. Under-recording spend on the
 * stopping path is the worst place in this pipeline to be blind.
 *
 * The signal is `OUT_OF_TIME`, which `REVIEW_AND_MUTATE` accepts, so the issue parks
 * in `INCOMPLETE` with this phase as `resumeFrom`, `attempts` carried and `lastError`
 * left null — nothing broke, a bound was reached.
 */
export const stopPartWayThrough = async (context: PartWayInput): Promise<PhaseOutcome> => {
  const { input, branch, stopped, system } = context
  const { deps, state } = input

  deps.log.warn(
    { issue: state.issueId, branch, toDeadlineMs: msToDeadline(deps.config, deps.now()), ...stopped.progress },
    'Out of time part-way through the turn; stopping it and keeping what it wrote',
  )

  const agent = await deps.agent()
  // Step 1. The abort is what stops the work; the wrap-up is what makes the window
  // worth its cost. Asking is conditional on the abort having taken, because the
  // premise of a second prompt is an idle session — a server still running a tool
  // child has no capacity to answer and the window would expire either way, buying
  // nothing and delaying the salvage.
  const softStopped = await agent.abort()
  const handoff = softStopped ? await askForHandoff(agent, system, deps) : null

  // Step 2. Unconditional, and it depends on nothing the model chose to do: the
  // wrap-up may have replied, refused, or started editing again.
  const hardStopped = await agent.abort()

  // Step 3. The fence is "some abort was accepted". The soft one is the meaningful
  // `true` — it is issued while a tool child is definitely running — and the hard one
  // covers a stop where the wrap-up was skipped. Neither accepted means the pipeline
  // has no evidence anything stopped, and it stages nothing.
  const salvage = await salvageWork({
    deps,
    issueNumber: state.issueId,
    branch,
    quiescent: softStopped || hardStopped,
  })

  return parkedOutcome(context, salvage, handoff)
}

/**
 * What the handler hands back: the notice, the handoff block, and the count.
 *
 * Separate from the sequence above so that each reads as one thing — the sequence is
 * three steps in a fixed order, this is the report of what they produced.
 */
const parkedOutcome = (context: PartWayInput, salvage: SalvageOutcome, handoff: string | null): PhaseOutcome => {
  const { deps, state } = context.input

  return {
    signal: 'OUT_OF_TIME',
    comment: renderStoppedPartWay({
      remainingMs: msToDeadline(deps.config, deps.now()) ?? 0,
      reserveMs: deps.config.teardownReserveMs,
      progress: context.stopped.progress,
      branch: context.branch,
      resumeFrom: state.phase,
      kept: salvage.kept,
      note: salvage.note,
      handoff,
    }),
    // Stamped with the plan it was implementing, which is what retires it: see
    // `findHandoff`. Absent rather than empty when there is no note, so a later job
    // reads the previous stop's account instead of an emptier one.
    blocks: handoff === null ? [] : [renderArtifact(HANDOFF_MARKER, handoff, state.planRevision)],
    // The count of what was actually kept. Overwritten by the continuation's own
    // commit, which is the same limitation `changedLines` already has across a
    // `/retry`; recording it here is what makes a salvage nobody continues legible.
    patch: salvage.kept === null ? {} : { changedLines: salvage.kept.lines },
  }
}

/**
 * The wrap-up: one bounded prompt in the same session, and a note or nothing.
 *
 * Bounded by `AGENT_WRAP_UP_MS` from out here rather than by the session's own
 * per-turn cap, which was sized for the work and would let a wrap-up spend the
 * teardown reserve. The bound abandons rather than cancels — `deadline.ts` says so —
 * which is exactly why step 2 above aborts again unconditionally.
 *
 * Every failure is a `null`: an expired window, a refusal, a session that will not
 * take a second prompt, an empty reply. None of them may stop the salvage, because
 * the handoff is the *nicest* thing this stop produces and the commit is the
 * necessary one.
 */
const askForHandoff = async (agent: OpenCodeAgent, system: string, deps: PhaseDeps): Promise<string | null> => {
  try {
    const reply = await withDeadline(
      agent.prompt({ system, prompt: WRAP_UP_PROMPT, agent: 'build' }),
      deps.config.wrapUpMs,
      (elapsed) => openCodeError(`The wrap-up did not answer within ${elapsed}ms (AGENT_WRAP_UP_MS)`),
    )

    const note = reply.text.trim()
    if (note.length > 0) return note

    deps.log.warn({}, 'The wrap-up returned nothing; the continuation gets the branch and the plan only')
    return null
  } catch (error) {
    deps.log.warn({ error: errorMessage(error) }, 'The wrap-up did not answer')
    return null
  }
}
