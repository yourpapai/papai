// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHash } from 'node:crypto'

import type { AutonomyConfig } from './config.js'
import type { DigestRecord } from './replay.js'
import type { ReviewLoopResult } from './review-loop.js'

/**
 * R3 classification input: a gate assumption in sidecar shape. `evidence`
 * absent (or its `files` empty/un-recordable) means the sidecar entry lacked
 * verifiable evidence or the sidecar failed to parse — fail closed
 * (high-blast). `blast_radius` is the agent's free text, display-only.
 */
export interface ClassifiableAssumption {
  readonly id: string
  readonly text: string
  readonly blast_radius: string
  readonly evidence?: { readonly files: readonly string[] }
}

export interface ClassifiedAssumption {
  readonly id: string
  readonly text: string
  readonly blastRadius: string
  readonly blast: 'low' | 'high'
  readonly files: readonly string[]
}

export interface ClassifyContext {
  /** Repo-relative change folder path, e.g. `openspec/changes/<name>`. */
  readonly changeDir: string
  /** Repo-relative run dir path, e.g. `.sdd-runner/runs/<id>`. */
  readonly runDir: string
  /** Repo-relative paths the pipeline itself recorded (artifact/materialize events). */
  readonly recordedPaths: readonly string[]
}

export interface PolicySignals {
  readonly reviewResult: ReviewLoopResult
  readonly trajectory: readonly DigestRecord[]
  readonly assumptions: readonly ClassifiedAssumption[]
  readonly spentUsd: number
  readonly costKnown: boolean
  readonly autoExtendsUsed: number
  readonly deadlineExpired: boolean
  readonly config: AutonomyConfig
  /** Plan mode (D5): switches the R4 projection to `spent + childCount × DEFAULT_ROUND_COST_USD`. */
  readonly childCount?: number
  /** Tree budget baseline (D10): ancestor spend added before the single-ceiling compare; 0 when unset. */
  readonly spendBaselineUsd?: number
}

export type PolicyRule = 'R1' | 'R2' | 'R3' | 'R4' | 'R5'

export interface PolicyDecision {
  readonly rule: 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'none'
  readonly action: 'approve' | 'extend' | 'accept-items' | 'gate'
  readonly evidenceDigest: string
}

const R2_WINDOW = 2
/** Conservative per-round cost projection when no rounds are recorded. */
const DEFAULT_ROUND_COST_USD = 0.5

function startsWithDir(repoRelative: string, dir: string): boolean {
  if (repoRelative === dir) return true
  return repoRelative.startsWith(`${dir}/`)
}

function isInsideBoundaries(file: string, ctx: ClassifyContext): boolean {
  return startsWithDir(file, ctx.changeDir) || startsWithDir(file, ctx.runDir)
}

function isSpecDelta(file: string, ctx: ClassifyContext): boolean {
  return startsWithDir(file, `${ctx.changeDir}/specs`) && file.endsWith('spec.md')
}

function isTasksChecklist(file: string, ctx: ClassifyContext): boolean {
  return file === `${ctx.changeDir}/tasks.md`
}

/**
 * R3 blast-radius triage — pure arithmetic over recorded run artifacts. An
 * assumption is low-blast iff it carries a non-empty `evidence.files` list
 * whose every entry is inside the change folder or run dir, was recorded by
 * the pipeline itself, touches no spec delta and no tasks checkbox line.
 * Everything else — including missing, empty, or un-cross-checkable evidence
 * and unparseable sidecars — is high-blast: fail closed, never vacuously
 * low-blast. The agent-emitted `blast_radius` text is display-only and never
 * consulted.
 */
export function classifyAssumptions(
  assumptions: readonly ClassifiableAssumption[],
  ctx: ClassifyContext,
): readonly ClassifiedAssumption[] {
  const recorded = new Set(ctx.recordedPaths)
  return assumptions.map((assumption) => {
    const files = assumption.evidence?.files ?? null
    const lowBlast =
      files !== null &&
      files.length > 0 &&
      files.every(
        (file) =>
          recorded.has(file) &&
          isInsideBoundaries(file, ctx) &&
          !isSpecDelta(file, ctx) &&
          !isTasksChecklist(file, ctx),
      )
    return {
      id: assumption.id,
      text: assumption.text,
      blastRadius: assumption.blast_radius,
      blast: lowBlast ? ('low' as const) : ('high' as const),
      files: files ?? [],
    }
  })
}

function digestOf(parts: readonly unknown[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 16)
}

function openTotal(record: DigestRecord): number {
  return record.counts.blocker + record.counts.material + record.counts.nitpick
}

function strictlyDecreasingLastK(trajectory: readonly DigestRecord[], k: number): boolean {
  if (trajectory.length < k) return false
  const window = trajectory.slice(-k)
  for (let i = 1; i < window.length; i += 1) {
    if (openTotal(window[i]!) >= openTotal(window[i - 1]!)) return false
  }
  return true
}

/**
 * Projected spend after one more round: current spend plus the median cost of
 * a completed round (spend spread evenly over recorded rounds; a conservative
 * constant when none are recorded). At plan mode (childCount set) the
 * projection is `spent + childCount × DEFAULT_ROUND_COST_USD` — one round's
 * conservative constant per planned child. A nested run's baseline (D10) is
 * added first, so every level compares against the single ceiling.
 */
function projectedSpend(signals: PolicySignals): number {
  const baseline = signals.spendBaselineUsd ?? 0
  if (signals.childCount !== undefined) {
    return baseline + signals.spentUsd + signals.childCount * DEFAULT_ROUND_COST_USD
  }
  const rounds = signals.reviewResult.rounds
  if (rounds <= 0) return baseline + signals.spentUsd + DEFAULT_ROUND_COST_USD
  return baseline + signals.spentUsd + signals.spentUsd / rounds
}

function gateDecision(rule: PolicyDecision['rule'], signals: PolicySignals, note: string): PolicyDecision {
  return {
    rule,
    action: 'gate',
    evidenceDigest: digestOf([note, signals.reviewResult.outcome, signals.spentUsd, signals.autoExtendsUsed]),
  }
}

function r4FailsClosed(signals: PolicySignals): PolicyDecision | null {
  if (!signals.costKnown) {
    return {
      rule: 'R4',
      action: 'gate',
      evidenceDigest: digestOf(['cost-unknown', signals.reviewResult.outcome]),
    }
  }
  if (projectedSpend(signals) >= signals.config.costCeilingUsd) {
    return {
      rule: 'R4',
      action: 'gate',
      evidenceDigest: digestOf(['over-ceiling', signals.spentUsd, signals.config.costCeilingUsd]),
    }
  }
  return null
}

/**
 * R1 converged-final-approve: a final gate with zero open BLOCKERs, zero open
 * MATERIALs, zero open NITPICKs, and all surviving assumptions classified
 * low-blast approves.
 */
function r1Decision(signals: PolicySignals): PolicyDecision | null {
  const converged = signals.reviewResult.outcome === 'converged'
  const zeroFindings =
    signals.reviewResult.openBlockers.length === 0 &&
    signals.reviewResult.openMaterial.length === 0 &&
    signals.reviewResult.openNitpicks.length === 0
  const allLowBlast = signals.assumptions.every((assumption) => assumption.blast === 'low')
  if (!(converged && zeroFindings && allLowBlast)) return null
  return {
    rule: 'R1',
    action: 'approve',
    evidenceDigest: digestOf([
      'r1',
      signals.reviewResult.rounds,
      signals.assumptions.map((a) => a.id),
      signals.assumptions.map((a) => a.files),
      signals.spentUsd,
      signals.costKnown,
    ]),
  }
}

/**
 * R3 partial accept-items rung on the final-gate ladder: with a low-blast
 * subset alongside items no rule can decide (a high-blast survivor), offer
 * accept-items for the low-blast part — the gate stays presented for the
 * rest. Suppressed at deadline expiry (conservative branches only).
 */
function r3Decision(signals: PolicySignals): PolicyDecision | null {
  if (signals.assumptions.length === 0) return null
  const lowBlast = signals.assumptions.filter((a) => a.blast === 'low')
  const hasHighBlast = signals.assumptions.some((a) => a.blast === 'high')
  if (lowBlast.length === 0 || !hasHighBlast) return null
  if (signals.deadlineExpired) return gateDecision('none', signals, 'r3-suppressed-at-expiry')
  return {
    rule: 'R3',
    action: 'accept-items',
    evidenceDigest: digestOf(['r3', lowBlast.map((a) => a.id), lowBlast.map((a) => a.files)]),
  }
}

/**
 * R2 trajectory-auto-extend (cap-hit ladder): zero open BLOCKERs, at least one
 * open MATERIAL, strictly decreasing open-findings totals over the last k=2
 * rounds — the trajectory window and the R4 budget guard are the sole
 * extension eligibility (no count bound).
 */
function r2Decision(signals: PolicySignals): PolicyDecision | null {
  const capHit = signals.reviewResult.outcome === 'cap-hit'
  const noBlockers = signals.reviewResult.openBlockers.length === 0
  const hasMaterial = signals.reviewResult.openMaterial.length > 0
  if (!(capHit && noBlockers && hasMaterial)) return null
  if (!strictlyDecreasingLastK(signals.trajectory, R2_WINDOW)) return null
  return {
    rule: 'R2',
    action: 'extend',
    evidenceDigest: digestOf(['r2', signals.trajectory.map(openTotal)]),
  }
}

/**
 * Final-gate ladder: never-cut pre-checks (open BLOCKER, R4 fail-closed) →
 * R1 approve → R3 accept-items → human gate.
 */
export function evaluateFinalGate(signals: PolicySignals): PolicyDecision {
  if (signals.reviewResult.openBlockers.length > 0) return gateDecision('none', signals, 'open-blocker')
  const r4 = r4FailsClosed(signals)
  if (r4 !== null) return r4
  const r1 = r1Decision(signals)
  if (r1 !== null) return r1
  const r3 = r3Decision(signals)
  if (r3 !== null) return r3
  return gateDecision('none', signals, 'final-undecidable')
}

/**
 * Cap-hit ladder: never-cut pre-checks (open BLOCKER, R4 fail-closed) →
 * R2 extend → human gate.
 */
export function evaluateCapHit(signals: PolicySignals): PolicyDecision {
  if (signals.reviewResult.openBlockers.length > 0) return gateDecision('none', signals, 'open-blocker')
  const r4 = r4FailsClosed(signals)
  if (r4 !== null) return r4
  const r2 = r2Decision(signals)
  if (r2 !== null) return r2
  return gateDecision('none', signals, 'cap-hit-undecidable')
}

/**
 * Plan-gate prelude (D5): the R4 budget guard only, then the human gate. No
 * rule can approve, extend, or accept-items at plan mode in part 2 — the
 * ladder's other rungs are structurally unreachable here.
 */
export function evaluatePlanGate(signals: PolicySignals): PolicyDecision {
  return r4FailsClosed(signals) ?? gateDecision('none', signals, 'plan-undecidable')
}
