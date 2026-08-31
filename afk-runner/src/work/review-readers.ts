// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { SpawnFn } from '../../../review-loop/src/agent-runner.js'
import { autonomyOf } from '../config.js'
import type { ExecGitFn, RunnerConfig } from '../config.js'
import type { SddEvent } from '../events.js'
import type { KernelContext } from '../kernel/machine.js'
import { openCountsOf } from '../legacy-fold.js'
import { ROUND_CAPS } from '../run-state.js'
import { projectedSpend } from './auto-policy.js'
import { costSummaryOf } from './gate-signals.js'
import type { ReviewLoopResult } from './review-loop.js'

export type ReviewOutcome = 'converged' | 'cap-hit' | 'incomplete'

/**
 * The review outcome as a pure reader of folded context: an unanswered gate
 * parks cap-hit (an answered one releases continuation — the extend path
 * never clears the gate record, so answered gates must not re-park); an
 * opened round without its recorded verdict still owes work (the
 * extend-at-final mover re-opens review after a converged verdict — C5 D3);
 * a passed review stage or a decompose entry settles review regardless of
 * verdict (the refused verification round enters the tail this way — D5); a
 * converged verdict — including the severity rule over the **open** set (a
 * nitpick-only open cap-hit counts as converged, mirroring the legacy
 * orchestrator) — is converged; a `needs-review` verdict at the depth's base
 * cap leaves review unsettled (the verification round it owes has not run),
 * while one recorded by a round opened above the base cap — the
 * verification round itself — settles whatever it recorded; anything else
 * means the loop still owes work (fresh, crashed mid-round, or
 * calm-stopped).
 */
export function reviewOutcomeOf(context: KernelContext): ReviewOutcome {
  if (context.gate !== null && !context.gate.answered) return 'cap-hit'
  const round = context.round
  if (round !== null && !context.perRound.some((record) => record.round === round.current)) {
    return 'incomplete'
  }
  const decompose = context.stages['decompose']
  if (decompose === 'done' || decompose === 'active') return 'converged'
  const verdict = context.lastVerdict
  if (verdict !== null && verdict.verdict === 'converged') return 'converged'
  if (verdict !== null && verdict.verdict === 'needs-review') {
    // The round this verdict came from sits at the depth's base cap: the one
    // verification round it owes has not been opened. Once a round above the
    // base cap records any verdict (the verification round, or a human
    // extend), review settles by that verdict through the paths below.
    return round !== null && round.cap > ROUND_CAPS[context.depth ?? 'S'] ? 'converged' : 'incomplete'
  }
  const open = verdict === null ? null : openCountsOf(verdict)
  if (open !== null && open.blocker === 0 && open.material === 0) return 'converged'
  return 'incomplete'
}

/** Cap-hit presents the early gate only with open blockers or materials (severity convergence flows through without a gate). */
export function presentsGate(result: ReviewLoopResult): boolean {
  return result.outcome === 'cap-hit' && !(result.openBlockers.length === 0 && result.openMaterial.length === 0)
}

export interface ReviewWorkAgents {
  readonly spawn: SpawnFn
  readonly config: RunnerConfig
  readonly execGit: ExecGitFn
}

export interface ReviewWorkInput {
  readonly agent: ReviewWorkAgents
  readonly repoRoot: string
  readonly changeName: string
  readonly taskText: string
  readonly conventions: string
  readonly stop?: { readonly stopRequested: () => boolean }
  readonly onSteerWarning?: (line: string) => void
}

/**
 * The budget question the verification round has to pass (R4's metered
 * semantics): an unknown cumulative cost refuses only on a metered run, a
 * null ceiling never refuses, and a numeric ceiling is reached by the
 * projection of one more round's spend.
 */
export function verificationBudgetRefuses(config: RunnerConfig, events: readonly SddEvent[], rounds: number): boolean {
  const autonomy = autonomyOf(config)
  const { costUsd, costKnown } = costSummaryOf(events)
  if (!costKnown && autonomy.metered) return true
  return autonomy.costCeilingUsd !== null && projectedSpend({ spentUsd: costUsd, rounds }) >= autonomy.costCeilingUsd
}
