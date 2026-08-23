// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { StageId } from './events.js'
import type { ReplayState } from './replay.js'
import { deriveResumePoint } from './resume-point.js'
import type { PersistedRunState } from './run-state.js'
import type { SessionLedgerLine } from './session-ledger.js'

export type ResumePath = 'artifact-skip' | 'session-continuation' | 'stage-rebuild'

export interface ResumedSession {
  readonly label: string
  readonly role: string
  readonly round: number
  readonly attempt: number
  readonly opencodeSessionId: string
}

export interface ResumeDecision {
  readonly path: ResumePath
  readonly stage: StageId
  readonly round: number
  readonly reason: string
  readonly session?: ResumedSession
}

function isInFlight(line: SessionLedgerLine): boolean {
  return line.opencodeSessionId !== null && (line.status === 'spawned' || line.status === 'killed')
}

/** Latest in-flight ledger line for a round, or null (design D1/D2). */
function resumePathOf(sessionRound: number | null, inFlight: SessionLedgerLine | null): ResumePath {
  if (sessionRound === null) return 'artifact-skip'
  if (inFlight === null) return 'stage-rebuild'
  return 'session-continuation'
}

function latestInFlight(ledger: readonly SessionLedgerLine[], round: number): SessionLedgerLine | null {
  const matches = ledger.filter((line) => line.round === round && isInFlight(line))
  return matches.length === 0 ? null : matches[matches.length - 1]!
}

/**
 * Resume decision table (design D2): artifact-first, session-second,
 * rebuild-last.
 *
 * - `artifact-skip`: the resume point needs no re-run of an in-flight agent —
 *   a gate awaits, or the interrupted stage's artifacts are complete and the
 *   pipeline simply continues past it (fresh review rounds are new spawns by
 *   design, not continuations).
 * - `session-continuation`: an agent was interrupted mid-spawn and the ledger
 *   holds its opencode session id — the resume continues that exact context.
 * - `stage-rebuild`: no usable session (pre-change run, settled, or id-less
 *   spawn) — the stage re-spawns from a rebuilt prompt, exactly today's
 *   behavior, and the fallback path for continuation failures.
 */
export function resolveResumeDecision(
  state: PersistedRunState,
  artifacts: Record<string, string>,
  replay: ReplayState,
  ledger: readonly SessionLedgerLine[],
): ResumeDecision {
  const point = deriveResumePoint(state, artifacts, replay)
  const sessionRound = resumeSessionRound(state, replay, point.stage)
  const inFlight = sessionRound === null ? null : latestInFlight(ledger, sessionRound)
  const path: ResumePath = resumePathOf(sessionRound, inFlight)
  return {
    path,
    stage: point.stage,
    round: point.round,
    reason: point.reason,
    ...(inFlight === null
      ? {}
      : {
          session: {
            label: inFlight.label,
            role: inFlight.role,
            round: inFlight.round,
            attempt: inFlight.attempt,
            opencodeSessionId: inFlight.opencodeSessionId!,
          },
        }),
  }
}

/**
 * The round whose in-flight session a resume would continue, or null when the
 * resume point runs no continuation candidate: a gate needs no agent, and a
 * review that never started (round 0 / interrupted before review) has no
 * in-flight session — its draft artifacts are complete or the draft stage
 * itself re-runs.
 */
function resumeSessionRound(state: PersistedRunState, replay: ReplayState, stage: StageId): number | null {
  if (stage === 'gate') return null
  if (stage !== 'review') return 0
  const current = Math.max(state.round, replay.round?.current ?? 0, 1)
  return state.round === 0 && replay.round === null ? null : current
}
