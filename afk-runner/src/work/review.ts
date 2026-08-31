// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'

import type { AgentLayerDeps } from '../agent-layer.js'
import type { WorkIO } from '../drive/loop.js'
import { reviewResumeEntry } from '../drive/resume.js'
import { readEvents } from '../events.js'
import type { DepthProfile, EventInput } from '../events.js'
import { pipelineMachine } from '../graph/pipeline.js'
import { foldEvents } from '../kernel/fold.js'
import type { KernelContext } from '../kernel/machine.js'
import { ROUND_CAPS } from '../run-state.js'
import { readSessionLedger } from '../session-ledger.js'
import { presentEarlyGate } from './early-gate.js'
import { readReviewResultFromSidecars } from './gate-settle.js'
import { createMaterializer } from './materialize.js'
import { runReviewLoop } from './review-loop.js'
import type { ReviewLoopDeps, ReviewLoopResult } from './review-loop.js'
import { presentsGate } from './review-readers.js'
import type { ReviewWorkInput } from './review-readers.js'
import { verificationBudgetRefuses } from './review-readers.js'

export { reviewOutcomeOf, presentsGate } from './review-readers.js'
export type { ReviewOutcome, ReviewWorkAgents, ReviewWorkInput } from './review-readers.js'

/**
 * Whether the fold owes the verification round: the last recorded round sits
 * at the depth's base cap with a `needs-review` verdict — nothing only a
 * human can settle, but an edit above a nitpick no reviewer has seen. A round
 * already opened above the base cap (the verification round itself, or a
 * human extend) means the chain spent its round: no second one is bought.
 */
export function owesVerificationRound(context: KernelContext, depth: DepthProfile): boolean {
  const round = context.round
  if (round === null || round.cap !== ROUND_CAPS[depth]) return false
  const last = context.lastVerdict
  return last !== null && last.round === round.current && last.verdict === 'needs-review'
}

/**
 * A refused verification round enters the tail directly — the final gate
 * presents the unreviewed edits to a human either way. No auto-decision is
 * appended for the refusal; the final gate's own ladder event is the record.
 */
function refuseVerification(scope: ReviewScope, round: number): Promise<ReviewLoopResult> {
  scope.emit({ altitude: 'L2', type: 'stage_enter', stage: 'decompose' })
  return readReviewResultFromSidecars(scope.sidecarDir, round, 'cap-hit')
}

/** Everything one review work pass binds: paths, the loop deps factory, the loop options. */
interface ReviewScope {
  readonly input: ReviewWorkInput
  readonly io: WorkIO
  readonly depth: DepthProfile
  readonly logPath: string
  readonly sidecarDir: string
  readonly runDir: string
  readonly emit: (event: EventInput) => void
  readonly entry: ReturnType<typeof reviewResumeEntry>
  readonly paths: {
    sidecarDir: string
    changeDir: string
    logPath: string
    emit: (event: EventInput) => void
    runDir: string
  }
  readonly loopDeps: (resumeSession: ReviewLoopDeps['resumeSession'], verifyCap: number | null) => ReviewLoopDeps
  readonly loopOptions: {
    readonly changeName: string
    readonly changeDir: string
    readonly depth: DepthProfile
    readonly taskText: string
    readonly conventions: string
  }
}

/** Run the loop for one entry shape; presentation stays with the callers (once per pass). */
function runScopeLoop(
  scope: ReviewScope,
  resumeSession: ReviewLoopDeps['resumeSession'],
  verifyCap: number | null,
  entry: {
    readonly startRound?: number
    readonly cap?: number
    readonly foldRound?: { readonly current: number; readonly cap: number } | null
  },
): Promise<ReviewLoopResult> {
  return runReviewLoop(scope.loopDeps(resumeSession, verifyCap), scope.loopOptions, entry)
}

/**
 * Cap-hit routing (D5): a `needs-review` cap-hit — nothing only a human can
 * settle, but an edit above a nitpick no reviewer has seen — buys exactly one
 * verification round when the budget guard allows; routing is never
 * re-entered from its result, and the fold-derived check keeps a resume from
 * stacking a second one after a crash. A refused round enters the tail.
 */
async function routeVerificationRound(
  scope: ReviewScope,
  result: ReviewLoopResult,
  settled: KernelContext,
): Promise<ReviewLoopResult> {
  if (!owesVerificationRound(settled, scope.depth) || scope.input.stop?.stopRequested() === true) return result
  if (verificationBudgetRefuses(scope.input.agent.config, readEvents(scope.logPath), result.rounds)) {
    scope.emit({ altitude: 'L2', type: 'stage_enter', stage: 'decompose' })
    return result
  }
  const verifyCap = (settled.round?.cap ?? ROUND_CAPS[scope.depth]) + 1
  const verified = await runScopeLoop(scope, undefined, verifyCap, {
    startRound: result.rounds + 1,
    cap: verifyCap,
    foldRound: settled.round,
  })
  return verified
}

/**
 * The resume-side verification pre-pass: a resumed run whose last recorded
 * round owes its verification round buys it here — before the loop would run
 * that round at the un-raised cap — so the resume emits the same
 * round_open(n+1, cap+1) shape as the fresh path. A refused round enters the
 * tail directly. Returns null when the fold owes no verification round.
 */
async function resumeVerificationEntry(scope: ReviewScope): Promise<ReviewLoopResult | null> {
  const owed = scope.io.context.round
  if (
    owed === null ||
    !owesVerificationRound(scope.io.context, scope.depth) ||
    scope.input.stop?.stopRequested() === true ||
    scope.entry.startRound !== owed.current + 1
  ) {
    return null
  }
  if (verificationBudgetRefuses(scope.input.agent.config, readEvents(scope.logPath), owed.current)) {
    return refuseVerification(scope, owed.current)
  }
  const verifyCap = (owed.cap ?? ROUND_CAPS[scope.depth]) + 1
  const result = await runScopeLoop(scope, undefined, verifyCap, {
    startRound: owed.current + 1,
    cap: verifyCap,
    foldRound: owed,
  })
  if (presentsGate(result)) {
    await presentEarlyGate(scope.input, scope.io, scope.paths, result)
  }
  return result
}

/**
 * The review work module body: the legacy review loop recursion stays inside;
 * rounds emit their domain events through the validated append; the re-entry
 * point derives from folded context plus the session ledger; a `needs-review`
 * cap-hit buys exactly one verification round when the budget guard allows
 * (a refused round enters the tail directly — no auto-decision records the
 * refusal, the final gate's own ladder event is the record); a blocking
 * cap-hit presents the full early gate (gate MD + hashes sidecar + presented
 * event) and the run parks gate-pending.
 */
/** Bind everything one review work pass needs (paths, loop deps, loop options). */
function buildReviewScope(input: ReviewWorkInput, io: WorkIO): ReviewScope {
  const emit = (event: EventInput): void => {
    io.append(event)
  }
  const runDir = io.runDir
  const logPath = path.join(runDir, 'events.ndjson')
  const sidecarDir = path.join(runDir, 'sidecars')
  const changeDir = path.join(input.repoRoot, 'openspec', 'changes', input.changeName)
  const materialize = createMaterializer(sidecarDir, changeDir, emit, input.repoRoot)
  const depth: DepthProfile = io.context.depth ?? 'S'
  const agent: AgentLayerDeps = {
    spawn: input.agent.spawn,
    config: input.agent.config,
    execGit: input.agent.execGit,
    emit,
  }
  return {
    input,
    io,
    depth,
    logPath,
    sidecarDir,
    emit,
    runDir,
    entry: reviewResumeEntry(io.context, readSessionLedger(runDir), depth),
    paths: { sidecarDir, changeDir, logPath, emit, runDir },
    loopDeps: loopDepsOf({ input, io, depth, agent, emit, runDir, sidecarDir, materialize }),
    loopOptions: {
      changeName: input.changeName,
      changeDir,
      depth,
      taskText: input.taskText,
      conventions: input.conventions,
    },
  }
}

/**
 * The loop deps factory: the steer seam re-reads the fold's persisted cap, or
 * one above it while this work pass is running the verification round — the
 * extend mover's round_open(n+1, cap+1) shape, not overridable back down.
 */
function loopDepsOf(bound: {
  readonly input: ReviewWorkInput
  readonly io: WorkIO
  readonly depth: DepthProfile
  readonly agent: AgentLayerDeps
  readonly emit: (event: EventInput) => void
  readonly runDir: string
  readonly sidecarDir: string
  readonly materialize: (round: number) => Promise<void>
}): (resumeSession: ReviewLoopDeps['resumeSession'], verifyCap: number | null) => ReviewLoopDeps {
  const { input, io, depth, agent, emit, runDir, sidecarDir, materialize } = bound
  return (resumeSession, verifyCap): ReviewLoopDeps => ({
    agent,
    emit,
    runDir,
    sidecarDir,
    cwd: input.repoRoot,
    materialize,
    ...(input.stop === undefined ? {} : { stop: input.stop }),
    ...(resumeSession === undefined ? {} : { resumeSession }),
    steer: {
      runDir,
      onWarning: input.onSteerWarning ?? ((): void => undefined),
      readRoundCap: (): number => verifyCap ?? io.context.round?.cap ?? ROUND_CAPS[depth],
    },
  })
}

/**
 * The review work module body: the legacy review loop recursion stays inside;
 * rounds emit their domain events through the validated append; the re-entry
 * point derives from folded context plus the session ledger; a `needs-review`
 * cap-hit buys exactly one verification round when the budget guard allows
 * (a refused round enters the tail directly — no auto-decision records the
 * refusal, the final gate's own ladder event is the record); a blocking
 * cap-hit presents the full early gate (gate MD + hashes sidecar + presented
 * event) and the run parks gate-pending.
 */
export async function runReviewWork(input: ReviewWorkInput, io: WorkIO): Promise<ReviewLoopResult> {
  const scope = buildReviewScope(input, io)
  const resumed = await resumeVerificationEntry(scope)
  if (resumed !== null) return resumed
  const entry = scope.entry
  let result = await runScopeLoop(scope, entry.resumeSession, null, {
    startRound: entry.startRound,
    cap: entry.cap,
    foldRound: entry.foldRound,
  })
  const settled = foldEvents(pipelineMachine, readEvents(scope.logPath)).snapshot.context
  result = await routeVerificationRound(scope, result, settled)
  if (presentsGate(result)) {
    await presentEarlyGate(input, io, scope.paths, result)
  }
  return result
}
