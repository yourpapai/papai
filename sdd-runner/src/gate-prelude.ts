// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readFileSync } from 'node:fs'
import { appendFile, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { classifyAssumptions, evaluateCapHit, evaluateFinalGate } from './auto-policy.js'
import type { PolicyDecision, PolicySignals } from './auto-policy.js'
import type { ClassifiedAssumption } from './auto-policy.js'
import type { AutonomyConfig } from './config.js'
import { AUTONOMY_DEFAULTS } from './config.js'
import { readEvents } from './events.js'
import type { SddEvent } from './events.js'
import type { OrchestratorDeps, StageContext } from './gate-digest.js'
import { logPathFor, nowOf } from './gate-digest.js'
import type { GateAssumption } from './gate-model.js'
import type { DigestRecord } from './replay.js'
import { replayEvents } from './replay.js'
import { ResolverOutputSchema } from './review-loop.js'
import type { ReviewLoopResult } from './review-loop.js'
import type { RunState } from './run-state.js'
import { pendingSteerOverride } from './steer.js'

export interface PolicyGateInput {
  readonly mode: 'early' | 'final'
  readonly version: number
  readonly events: readonly SddEvent[]
  readonly costUsd: number
  readonly costKnown: boolean
  readonly assumptions: readonly GateAssumption[]
  readonly trajectory: readonly DigestRecord[]
}

/** A ladder run's outputs: the decision plus the classified assumptions. */
export interface PolicyEvaluation {
  readonly decision: PolicyDecision
  readonly classified: readonly ClassifiedAssumption[]
}

/**
 * Assemble `PolicySignals` and run the ladder once for a gate. Step-1
 * integrity cross-checks live here: a resolver sidecar that fails
 * `ResolverOutputSchema.parse` yields an unknown review result (fail closed —
 * the ladder sees an open BLOCKER so no rule can fire), and R1 additionally
 * requires the replay-folded open-finding counts from `events.ndjson` to
 * agree with the sidecar counts.
 */
export function runPolicyLadder(
  deps: OrchestratorDeps,
  state: RunState,
  ctx: StageContext,
  reviewResult: ReviewLoopResult,
  input: PolicyGateInput,
): PolicyEvaluation {
  const autonomy: AutonomyConfig = deps.autonomy ?? AUTONOMY_DEFAULTS
  const sidecarCounts = openCountsFromSidecarsSync(ctx.sidecarDir, reviewResult.rounds)
  const review = guardedReviewResult(reviewResult, state, sidecarCounts)
  const classified = classifyForPolicy(deps, ctx, state, input.assumptions)
  const signals: PolicySignals = {
    reviewResult: review,
    trajectory: input.trajectory,
    assumptions: classified,
    spentUsd: input.costUsd,
    costKnown: input.costKnown,
    autoExtendsUsed: state.autoExtendsUsed,
    deadlineExpired: false,
    config: autonomy,
  }
  const decision = input.mode === 'early' ? evaluateCapHit(signals) : evaluateFinalGate(signals)
  return { decision, classified }
}

function guardedReviewResult(
  reviewResult: ReviewLoopResult,
  state: RunState,
  sidecarCounts: { blocker: number; material: number; nitpick: number } | null,
): ReviewLoopResult {
  if (sidecarCounts === null) {
    return integrityBlocked(reviewResult, 'sidecar unparseable')
  }
  const verdict = replayEvents(logPathFor(state)).lastVerdict
  if (
    verdict !== null &&
    (verdict.counts.blocker !== sidecarCounts.blocker ||
      verdict.counts.material !== sidecarCounts.material ||
      verdict.counts.nitpick !== sidecarCounts.nitpick)
  ) {
    return integrityBlocked(reviewResult, 'sidecar/event count mismatch')
  }
  return reviewResult
}

function integrityBlocked(reviewResult: ReviewLoopResult, why: string): ReviewLoopResult {
  return {
    ...reviewResult,
    openBlockers: [{ id: 'POLICY-INTEGRITY', class: 'BLOCKER', resolution: 'evidence-answered', outcome: why }],
  }
}

function classifyForPolicy(
  deps: OrchestratorDeps,
  ctx: StageContext,
  state: RunState,
  assumptions: readonly GateAssumption[],
): readonly ClassifiedAssumption[] {
  const recordedPaths = readEvents(logPathFor(state))
    .filter((event) => event.type === 'artifact')
    .map((event) => (event as { path: string }).path)
  const changeDirRel = path.relative(deps.config.repoRoot, ctx.changeDir)
  const runDirRel = path.relative(deps.config.repoRoot, state.runDir)
  return classifyAssumptions(assumptions, { changeDir: changeDirRel, runDir: runDirRel, recordedPaths })
}

function openCountsFromSidecarsSync(
  sidecarDir: string,
  rounds: number,
): { blocker: number; material: number; nitpick: number } | null {
  try {
    const raw = readFileSync(path.join(sidecarDir, `resolutions-${rounds}.json`), 'utf8')
    const parsed = ResolverOutputSchema.parse(JSON.parse(raw))
    const counts = { blocker: 0, material: 0, nitpick: 0 }
    for (const resolution of parsed.resolutions) {
      if (resolution.class === 'BLOCKER') counts.blocker += 1
      else if (resolution.class === 'MATERIAL') counts.material += 1
      else counts.nitpick += 1
    }
    return counts
  } catch {
    return null
  }
}

/**
 * What the gate seam should do with a ladder decision at the configured
 * level: `settle` auto-settles the gate, `extend` routes into the extend
 * round (caller must own the extended review), `present` shows the human
 * gate (with the additive record).
 */
export type GatePresentationPlan =
  | { readonly action: 'settle'; readonly decision: PolicyDecision }
  | { readonly action: 'extend'; readonly decision: PolicyDecision }
  | { readonly action: 'accept-items'; readonly decision: PolicyDecision }
  | { readonly action: 'present'; readonly decision: PolicyDecision }

export function planGatePresentation(decision: PolicyDecision): GatePresentationPlan {
  if (decision.action === 'approve') return { action: 'settle', decision }
  if (decision.action === 'extend') return { action: 'extend', decision }
  if (decision.action === 'accept-items') return { action: 'accept-items', decision }
  return { action: 'present', decision }
}

/**
 * Level-aware additive record for a presented gate (D3 steps 3+5): at
 * `observe` every gate gets the parse-inert preview block, one
 * `auto-policy.jsonl` line, and a `decision: 'preview'` event. At
 * `assist`/`auto` an undecidable (or rule-not-permitted) gate still gets the
 * preview block plus a `decision: 'gate'` event naming the rule, and the seam
 * appends the workdir-level policy-debt ledger entry — the seam is the
 * single writer (D9).
 */
export async function writePresentedRecord(
  deps: OrchestratorDeps,
  state: RunState,
  ctx: StageContext,
  evaluation: PolicyEvaluation,
  input: PolicyGateInput,
): Promise<void> {
  const { decision, classified } = evaluation
  const gateMdPath = path.join(state.runDir, `gate-${input.version}.md`)
  if (decision.action === 'accept-items') {
    await preCheckLowBlastItems(gateMdPath, classified, decision.rule)
  }
  await appendFile(gateMdPath, renderPreviewBlock(decision))
  const eventKind = decision.action === 'accept-items' ? 'accept-items' : 'gate'
  const record = {
    ts: nowOf(deps).toISOString(),
    gateVersion: input.version,
    rule: decision.rule,
    decision: eventKind,
    evidenceDigest: decision.evidenceDigest,
  }
  await appendFile(path.join(state.runDir, 'auto-policy.jsonl'), `${JSON.stringify(record)}\n`)
  ctx.emit({
    altitude: 'L2',
    type: 'auto_decision',
    rule: decision.rule,
    decision: eventKind,
    evidenceDigest: decision.evidenceDigest,
    gateVersion: input.version,
  })
  if (decision.action !== 'accept-items') {
    await appendPolicyDebt(deps, state, decision, input.version)
  }
}

/**
 * R3 partial pre-check-and-present (D3): the low-blast items of a mixed gate
 * are pre-checked in the gate file with `· decided-by: policy R3`
 * annotations; the gate is still presented to the human for the remaining
 * items. Pre-checking only the low-blast subset leaves the human the full
 * veto surface for everything the rule could not decide.
 */
async function preCheckLowBlastItems(
  gateMdPath: string,
  classified: readonly ClassifiedAssumption[],
  rule: PolicyDecision['rule'],
): Promise<void> {
  const lowBlast = new Set(classified.filter((a) => a.blast === 'low').map((a) => a.id))
  if (lowBlast.size === 0) return
  const md = await readFile(gateMdPath, 'utf8')
  const updated = md
    .split('\n')
    .map((line) => {
      const match = line.match(/^-\s\[\s\]\s(A\d+)\s(.*)$/u)
      if (match === null) return line
      const id = match[1] ?? ''
      if (!lowBlast.has(id)) return line
      return `- [x] ${id} ${match[2] ?? ''} · decided-by: policy ${rule}`
    })
    .join('\n')
  await writeFile(gateMdPath, updated)
}

async function appendPolicyDebt(
  deps: OrchestratorDeps,
  state: RunState,
  decision: PolicyDecision,
  version: number,
): Promise<void> {
  const ledger = {
    ts: nowOf(deps).toISOString(),
    runId: state.runId,
    gateVersion: version,
    rule: decision.rule,
    evidenceDigest: decision.evidenceDigest,
  }
  await appendFile(path.join(deps.config.workDir, 'policy-debt.jsonl'), `${JSON.stringify(ledger)}\n`)
}

/** Parse-inert by construction: every line is `> `-prefixed blockquote. */
export function renderPreviewBlock(decision: PolicyDecision): string {
  const lines = [
    '',
    '### Auto-decision preview',
    '',
    `> rule: ${decision.rule}`,
    `> decision: ${decision.action}`,
    `> evidence: ${decision.evidenceDigest}`,
    '',
  ]
  return `${lines.join('\n')}\n`
}

/**
 * D3 step 0 never-cut pre-check applied to the plan: a queued steer
 * abort/veto (raw steer.md or the persisted staged set) takes precedence
 * over any pending auto-settle — the gate is presented to the human instead.
 */
export function planForGate(state: RunState, evaluation: PolicyEvaluation | null): GatePresentationPlan | null {
  if (evaluation === null) return null
  const plan = planGatePresentation(evaluation.decision)
  if (plan.action === 'settle' && pendingSteerOverride(state.runDir)) {
    return { action: 'present', decision: evaluation.decision }
  }
  return plan
}
