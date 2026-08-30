// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

import type { DepthProfile, EventInput } from '../events.js'
import { readEvents, StageIdSchema } from '../events.js'
import { pipelineMachine } from '../graph/pipeline.js'
import { foldEvents } from '../kernel/fold.js'
import type { KernelContext, RoundStatus } from '../kernel/machine.js'
import { ROUND_CAPS } from '../run-state.js'
import type { SessionLedgerLine } from '../session-ledger.js'
import { escalationOwed, escalationStageOf } from './failure-budget.js'
import type { ParkedReason, WorkFor } from './loop.js'

export interface ResumeSession {
  readonly label: string
  readonly opencodeSessionId: string
  readonly round: number
}

export interface ReviewEntry {
  readonly startRound: number
  readonly cap: number
  readonly resumeSession?: ResumeSession
  /**
   * The fold's round snapshot at work entry (log-fidelity D2): the
   * `round_open` owedness baseline. A round already open at exactly this cap
   * in the entry fold owes no fresh emission — resume, extend re-entry, and
   * escalation retry re-run the work without re-opening the round.
   */
  readonly foldRound: RoundStatus | null
}

function latestInFlight(ledger: readonly SessionLedgerLine[], round: number): SessionLedgerLine | null {
  const matches = ledger.filter(
    (line) =>
      line.round === round &&
      line.opencodeSessionId !== null &&
      (line.status === 'spawned' || line.status === 'killed'),
  )
  return matches.length === 0 ? null : matches[matches.length - 1]!
}

/**
 * The review re-entry point as a pure function of folded context plus the
 * session ledger (design D6): round and cap from the last `round_open`; a
 * round whose verdict is already recorded completed, so the resume enters the
 * next round fresh — an unrecorded round was interrupted mid-flight and re-runs
 * from the ledger's latest in-flight session. A run with no opened round
 * starts fresh at round 1.
 */
export function reviewResumeEntry(
  context: KernelContext,
  ledger: readonly SessionLedgerLine[],
  depth: DepthProfile | null,
): ReviewEntry {
  const round = context.round
  if (round === null) return { startRound: 1, cap: ROUND_CAPS[depth ?? 'S'], foldRound: null }
  const recorded = context.perRound.some((record) => record.round === round.current)
  if (recorded) return { startRound: round.current + 1, cap: round.cap, foldRound: round }
  const inFlight = latestInFlight(ledger, round.current)
  return {
    startRound: round.current,
    cap: round.cap,
    foldRound: round,
    ...(inFlight === null
      ? {}
      : {
          resumeSession: {
            label: inFlight.label,
            opencodeSessionId: inFlight.opencodeSessionId!,
            round: inFlight.round,
          },
        }),
  }
}

/**
 * A run is drivable when its state module still owes work or movement;
 * otherwise it reports a parked reason as data. Unknown positions and
 * workless successors park defensively as `final` (C5 D6 — the boundary's
 * refusal vocabulary remains the alarm for illegal movement). C6 D3: the
 * budget check is consulted here symmetrically — an over-budget stage owes an
 * escalation gate, not another work re-entry.
 */

/**
 * The resume-invocation event (log-fidelity D3/D5): one `resume` per
 * invocation, classified from the post-recovery fold plus the session
 * ledger. Presented gates — including runs the resume's own recovery just
 * completed through a gate settle — report `artifact-skip, gate`; review
 * splits by round state (never started → artifact-skip, unrecorded round →
 * the ledger session when in flight, else a fresh re-run); every other work
 * position rebuilds its stage. A `start` fold has nothing to continue and
 * boots from intake.
 */
export function resumeEventOf(
  context: KernelContext,
  position: string,
  ledger: readonly SessionLedgerLine[],
): EventInput {
  if (position === 'gate.awaiting' || position === 'completed' || position === 'aborted') {
    return { altitude: 'L2', type: 'resume', path: 'artifact-skip', stage: 'gate' }
  }
  if (position === 'review') {
    const round = context.round
    if (round === null) return { altitude: 'L2', type: 'resume', path: 'artifact-skip', stage: 'review' }
    const recorded = context.perRound.some((record) => record.round === round.current)
    const inFlight = recorded ? null : latestInFlight(ledger, round.current)
    if (inFlight !== null) {
      return {
        altitude: 'L2',
        type: 'resume',
        path: 'session-continuation',
        stage: 'review',
        session: inFlight.opencodeSessionId!,
      }
    }
    return { altitude: 'L2', type: 'resume', path: 'stage-rebuild', stage: 'review' }
  }
  return {
    altitude: 'L2',
    type: 'resume',
    path: 'stage-rebuild',
    stage: StageIdSchema.parse(position === 'start' ? 'intake' : position),
  }
}

export function parkedReasonOf(context: KernelContext, position: string, workFor: WorkFor): ParkedReason | 'drivable' {
  const module = workFor(position)
  if (module === null) return 'final'
  if (escalationOwed(context, position)) return 'gate-pending'
  const successor = module.successors[module.outcomeOf(context)]
  if (successor === undefined) return 'drivable'
  if ('park' in successor) return successor.park
  const target = workFor(successor.enter)
  return target === null || target.work === null ? 'final' : 'drivable'
}

/**
 * Owed-mover recovery (design D7): a log whose answered event carries an
 * explicit outcome but whose mover event never landed — the crash window
 * between the two appends — resumes by appending the owed mover. A
 * historical answered event without an outcome owes nothing: it parks
 * awaiting settlement and heals on the next settle instead.
 *
 * C5 map-signal gating (D5): the extend and approve-early movers are
 * interstitial moves — owed only while the gate stage is NOT active in the
 * map. An active gate stage under an answered record is the W3 crash window
 * (the final presentation never landed, so the record is null or stale);
 * appending a mover there would phantom-open a round for an extend that
 * already landed. Veto movers are position-guarded already: a landed veto
 * mover has left `gate.awaiting`.
 *
 * C6 escalation rows (W7): the mover targets the still-active failed stage —
 * approve re-enters it directly; extend closes its bracket first (the exit
 * clears the failure ledger, C6 D2) then re-enters.
 */
export function owedMoversOf(context: KernelContext, position: string): readonly EventInput[] {
  if (position !== 'gate.awaiting') return []
  const gate = context.gate
  if (gate === null || !gate.answered) return []
  if (gate.mode === 'escalation') {
    const failedStage = escalationStageOf(context)
    if (failedStage === null) return []
    if (context.gateOutcome === 'approve' || context.gateOutcome === 'extend') {
      return [
        { altitude: 'L2', type: 'stage_exit', stage: failedStage },
        { altitude: 'L2', type: 'stage_enter', stage: failedStage },
      ]
    }
    return []
  }
  const mapGateActive = context.stages['gate'] === 'active'
  if (context.gateOutcome === 'extend' && !mapGateActive) {
    const round = context.round
    return [
      {
        altitude: 'L2',
        type: 'round_open',
        round: (round?.current ?? 0) + 1,
        cap: (round?.cap ?? 0) + 1,
      },
    ]
  }
  if (context.gateOutcome === 'approve' && gate.mode === 'early' && !mapGateActive) {
    return [{ altitude: 'L2', type: 'stage_enter', stage: 'decompose' }]
  }
  if (context.gateOutcome === 'veto') {
    return [{ altitude: 'L2', type: 'stage_enter', stage: 'draft' }]
  }
  return []
}

/** The highest `gate-<n>.md` version on disk, or null when no gate file exists. */
export function latestGateFileVersion(runDir: string): number | null {
  if (!existsSync(runDir)) return null
  const versions = readdirSync(runDir)
    .map((name) => /^gate-(\d+)\.md$/u.exec(name)?.[1])
    .filter((match): match is string => match !== undefined)
    .map(Number)
  return versions.length === 0 ? null : Math.max(...versions)
}

/**
 * Owed escalation presentation (C6 D10, W5/W6): the presenter died between
 * the `stage_failed` appends and the presented event — the budget is spent at
 * the active stage, no gate parks the run, and the machine never entered the
 * compound. Returns the stage and the on-disk file version when the crashed
 * presentation's file exists (re-present at that version); null version means
 * fresh-render.
 */
export function owedEscalationPresentationOf(
  context: KernelContext,
  position: string,
  runDir: string,
): { readonly stage: string; readonly version: number | null } | null {
  if (!escalationOwed(context, position)) return null
  if (context.stages['gate'] === 'active') return null
  const next = (context.gate?.version ?? 0) + 1
  return { stage: position, version: existsSync(path.join(runDir, `gate-${next}.md`)) ? next : null }
}

/**
 * Owed-presentation recovery (C5 D5): the W3 crash window — the presenter
 * died between `stage_enter(gate)` and the presented event. The machine sits
 * in `gate.awaiting` with the gate stage active in the map and a gate record
 * that is null (nothing ever presented) or stale (an answered earlier gate
 * below the on-disk file version — file-first rendering guarantees the
 * crashed presentation's file exists). Returns the owed presented event at
 * the file-scan version; the caller re-runs the ladder after appending it.
 *
 * W4 (accepted risk, no recovery): a crash between the presented event and
 * the ladder's `auto_decision` record loses only that record — the gate
 * settles normally on the next producer. Re-running the ladder there is NOT
 * safe: a second R2 record would double-count against the auto-extend
 * allowance, and the window is milliseconds wide.
 */
export function owedPresentationOf(context: KernelContext, position: string, runDir: string): EventInput | null {
  if (position !== 'gate.awaiting') return null
  if (context.stages['gate'] !== 'active') return null
  const version = latestGateFileVersion(runDir)
  if (version === null) return null
  const gate = context.gate
  if (gate !== null && !gate.answered) return null
  if (gate !== null && gate.version >= version) return null
  return { altitude: 'L2', type: 'gate', action: 'presented', mode: 'final', version }
}

/** The refolded context after appends landed — the ladder consumes post-append truth. */
export function refoldedContext(logPath: string): KernelContext {
  return foldEvents(pipelineMachine, readEvents(logPath)).snapshot.context
}
