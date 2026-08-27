// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { DepthProfile } from '../events.js'
import type { KernelContext } from '../kernel/machine.js'
import { ROUND_CAPS } from '../run-state.js'
import type { SessionLedgerLine } from '../session-ledger.js'
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
  if (round === null) return { startRound: 1, cap: ROUND_CAPS[depth ?? 'S'] }
  const recorded = context.perRound.some((record) => record.round === round.current)
  if (recorded) return { startRound: round.current + 1, cap: round.cap }
  const inFlight = latestInFlight(ledger, round.current)
  return {
    startRound: round.current,
    cap: round.cap,
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

/** A run is drivable when its state module still owes work or movement; otherwise it reports a parked reason as data. */
export function parkedReasonOf(context: KernelContext, position: string, workFor: WorkFor): ParkedReason | 'drivable' {
  const module = workFor(position)
  if (module === null) return 'awaiting-tail'
  const successor = module.successors[module.outcomeOf(context)]
  if (successor === undefined) return 'drivable'
  if ('park' in successor) return successor.park
  const target = workFor(successor.enter)
  return target === null || target.work === null ? 'awaiting-tail' : 'drivable'
}
