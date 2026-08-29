// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { consumeSteerFile } from './steer.js'

/** What a round boundary consults: the steering seam and the resumed session. */
export interface BoundaryDeps {
  readonly steer?: {
    readonly runDir: string
    readonly onWarning: (line: string) => void
    readonly onDirectives?: (directives: readonly import('./steer.js').SteerDirective[]) => void
    readonly readRoundCap: () => number
  }
}

/** A recorded opencode session a resumed round may continue. */
export interface ResumedSpawn {
  readonly label: string
  readonly opencodeSessionId: string
  readonly round: number
}

/**
 * Round-boundary steer consumption (D6): at each round-cap evaluation point
 * consume `steer.md` (rename-on-consume, staged set persisted first), surface
 * unknown directives as warn lines, and re-read the persisted round cap so a
 * steered `extend` takes effect at this boundary — never consuming
 * `autoExtendsUsed`.
 */
export function applySteerAtBoundary(deps: BoundaryDeps, entryCap: number): number {
  const steer = deps.steer
  if (steer === undefined) return entryCap
  const consumed = consumeSteerFile(steer.runDir)
  for (const warning of consumed.warnings) steer.onWarning(warning)
  if (consumed.valid.length > 0) steer.onDirectives?.(consumed.valid)
  return steer.readRoundCap()
}

/**
 * The resumed session applies only to the round it was recorded in; a resume
 * entering an earlier round runs it fresh by design.
 */
export function consumeResumeSession(resumeSession: ResumedSpawn | undefined, round: number): ResumedSpawn | undefined {
  if (resumeSession === undefined || resumeSession.round !== round) return undefined
  return resumeSession
}

/** The resume session id for a given spawn label in this round, if it matches. */
export function sessionForLabel(
  consumedSession: ResumedSpawn | undefined,
  label: string,
  round: number,
): string | undefined {
  if (consumedSession === undefined) return undefined
  return consumedSession.label === `${label}-r${round}` ? consumedSession.opencodeSessionId : undefined
}
