// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { AgentLayerDeps } from './agent-layer.js'
import { DEFAULT_ROUND_COST_USD } from './auto-policy.js'
import { runPlanBranch } from './children.js'
import { runAtomicity, runDecompose } from './decompose.js'
import type { DecomposeReport } from './decompose.js'
import type { DepthProfile } from './events.js'
import { readChangeDigest } from './gate-digest-extract.js'
import { nowOf, presentGateAt } from './gate-digest.js'
import type { OrchestratorDeps, RunStartResult, StageContext } from './gate-digest.js'
import { gatherGateSignals } from './gate-signals.js'
import { runPlanner } from './intake.js'
import type { PlanChild } from './plan.js'
import type { ReviewLoopResult } from './review-loop.js'
import { saveRunState } from './run-state.js'
import type { RunState } from './run-state.js'
import { createStageMachine } from './stage-machine.js'

export interface PostConvergenceTailInput {
  readonly deps: OrchestratorDeps
  readonly state: RunState
  readonly ctx: StageContext
  readonly agent: AgentLayerDeps
  readonly depth: DepthProfile
  readonly reviewResult: ReviewLoopResult
  readonly version: number
  /**
   * Runs one further review round over unreviewed edits. Supplied by callers
   * that own the review loop; absent for callers that cannot spend a round,
   * which then continue straight to the final gate. Routing is never
   * re-entered from its result — that is what bounds it to one per cap-hit.
   */
  readonly runVerification?: (result: ReviewLoopResult) => Promise<ReviewLoopResult>
}

/** What a settled review round does next. */
export type CapHitRoute = { readonly kind: 'tail' } | { readonly kind: 'early-gate' } | { readonly kind: 'verify' }

export interface RouteConditions {
  /** A verification round has already been spent for this cap-hit. */
  readonly verified?: boolean
  /** The budget guard refuses another round's spend. */
  readonly overBudget?: boolean
}

/**
 * Route a settled review by its verdict. Three outcomes, one each for the three
 * things a round can leave behind:
 *
 * - `open` — something only a human can settle, so the early gate is presented.
 *   This holds even after a verification round: that round can dismiss a
 *   finding of its own, and a spent round does not waive the human's call.
 * - `needs-review` — nothing open, but an edit no reviewer has seen. One
 *   further round looks at it. The bound is structural: the verification
 *   round's own result routes straight to the tail rather than back through
 *   here, so a second can never be granted for the same cap-hit.
 * - `converged` — into the tail, no gate.
 *
 * An over-budget verification round is declined rather than deferred; the run
 * continues to its final gate, where a human sees the result either way.
 */
export function routeCapHit(reviewResult: ReviewLoopResult, conditions: RouteConditions = {}): CapHitRoute {
  if (reviewResult.outcome !== 'cap-hit') return { kind: 'tail' }
  // Gating keys on findings above a nitpick, exactly as severity convergence
  // always has. The verdict's three-nitpick bar governs whether the loop keeps
  // running, which is a different question from whether a human is needed, and
  // routing on it would newly gate the nitpick-heavy cap-hits that used to
  // flow straight through.
  if (!isSeverityConverged(reviewResult)) return { kind: 'early-gate' }
  if (reviewResult.verdict !== 'needs-review') return { kind: 'tail' }
  if (conditions.verified === true || conditions.overBudget === true) return { kind: 'tail' }
  return { kind: 'verify' }
}

/**
 * Post-review routing: a converged or severity-converged outcome runs the
 * shared post-convergence tail, an open cap-hit presents the early gate, and a
 * cap-hit carrying unreviewed edits buys exactly one verification round first.
 */
export async function runPostReviewToGate(input: PostConvergenceTailInput): Promise<RunStartResult> {
  const verify = input.runVerification
  const route = routeCapHit(input.reviewResult, await routeConditionsFor(input))
  if (route.kind === 'early-gate') {
    return presentGateAt(input.deps, input.state, input.ctx, input.reviewResult, input.version, 'early')
  }
  // A caller with no verification seam cannot spend the round; it continues to
  // the final gate, where a human sees the unreviewed edits either way.
  if (route.kind === 'verify' && verify !== undefined) {
    return runPostConvergenceTail({ ...input, reviewResult: await verify(input.reviewResult) })
  }
  return runPostConvergenceTail(input)
}

/**
 * Severity-based convergence: a cap-hit round with nothing a human must settle
 * flows into decompose without an early gate.
 */
export function isSeverityConverged(reviewResult: ReviewLoopResult): boolean {
  return (
    reviewResult.outcome === 'cap-hit' &&
    reviewResult.openBlockers.length === 0 &&
    reviewResult.openMaterial.length === 0
  )
}

/**
 * D5 split re-entry input: the composed task text handed back to the planner
 * — the original task, the existing change name (child #1 of the split), its
 * drafted-artifact summary, and the re-scoped first-slice-only tasks.md.
 */
export interface SplitReentryTextInput {
  readonly originalTask: string | null
  readonly changeName: string
  readonly artifactSummary: readonly string[]
  readonly tasksMd: string
}

export function buildSplitReentryTaskText(input: SplitReentryTextInput): string {
  const parts = [
    'A decompose verdict marked this change needs_split: it cannot land as one atomic-shippable change.',
    'Plan the child-run family that ships it: child #1 is the existing change itself (its slice is',
    'already drafted and reviewed); the siblings partition the remainder of the work.',
  ]
  if (input.originalTask !== null) parts.push('', 'Original task:', input.originalTask)
  parts.push('', `Existing change: ${input.changeName} — child #1 of the split`)
  if (input.artifactSummary.length > 0) {
    parts.push('', 'Drafted artifacts:', ...input.artifactSummary.map((line) => `- ${line}`))
  }
  parts.push('', 'Re-scoped tasks.md (child #1 slice only):', input.tasksMd)
  return parts.join('\n')
}

/**
 * D5 diversion: convert the run into a plan parent before any further stage
 * spend — re-enter through the landed `runPlanner` over the composed task
 * text, pin child #1 to the existing change (durably, in the promoted
 * `sidecars/plan.json` the child walk reads), then let the landed
 * `runPlanBranch` do the conversion itself (state.plan/children seeding,
 * `plan` event, plan-gate presentation with the R4-only prelude).
 */
async function divertToSplitPlan(input: PostConvergenceTailInput): Promise<RunStartResult> {
  const { deps, state, ctx, agent } = input
  const changeDir = path.join(ctx.cwd, 'openspec', 'changes', state.changeName)
  const [originalTask, tasksMd, digest] = await Promise.all([
    readFile(path.join(state.runDir, 'task.md'), 'utf8').catch(() => null),
    readFile(path.join(changeDir, 'tasks.md'), 'utf8').catch(() => ''),
    readChangeDigest(changeDir),
  ])
  const artifactSummary = [
    ...(digest.what === null ? [] : [`what: ${digest.what}`]),
    ...(digest.why === null ? [] : [`why: ${digest.why}`]),
    ...(digest.touches ?? []).map((touch) => `touches: ${touch}`),
  ]
  const children = await runPlanner(
    { driver: deps.driver, agent, emit: ctx.emit, sidecarDir: ctx.sidecarDir, runDir: state.runDir, cwd: ctx.cwd },
    {
      changeName: state.changeName,
      taskText: buildSplitReentryTaskText({ originalTask, changeName: state.changeName, artifactSummary, tasksMd }),
    },
  )
  const pinned: PlanChild[] = children.map((child, index) =>
    index === 0 ? { ...child, changeName: state.changeName } : child,
  )
  await writeFile(path.join(ctx.sidecarDir, 'plan.json'), `${JSON.stringify({ children: pinned }, null, 2)}\n`)
  return runPlanBranch(deps, state, ctx, pinned, { version: input.version })
}

/**
 * Shared post-convergence tail: decompose → atomicity (depth ≠ S) → final
 * gate at `version`. Serves the fresh pipeline's converged path, the extend
 * round's converged continuation, and the early-gate approval continuation,
 * so every route into the tail presents the same final-gate shape. A
 * `needs_split: true` decompose report diverts between decompose and
 * atomicity (D5): no atomicity spawn, no final gate, until the plan gate
 * settles.
 */
/**
 * The budget question the verification round has to pass: would one more
 * round's conservative projection reach the configured ceiling? Unknown cost
 * fails closed the same way R4 does — an unmeterable run does not get to spend
 * a round it cannot account for.
 */
async function routeConditionsFor(input: PostConvergenceTailInput): Promise<RouteConditions> {
  if (input.reviewResult.verdict !== 'needs-review') return {}
  const signals = await gatherGateSignals(input.deps, input.state, input.ctx, input.reviewResult)
  const ceiling = input.deps.autonomy?.costCeilingUsd ?? input.deps.config.budget
  const baseline = input.state.spendBaselineUsd ?? 0
  const rounds = input.reviewResult.rounds
  const perRound = rounds > 0 ? signals.costUsd / rounds : DEFAULT_ROUND_COST_USD
  const projected = baseline + signals.costUsd + perRound
  return { overBudget: !signals.costKnown || projected >= ceiling }
}

export async function runPostConvergenceTail(input: PostConvergenceTailInput): Promise<RunStartResult> {
  const { deps, state, ctx, agent } = input
  const machine = createStageMachine({ emit: ctx.emit })
  const decompose: { report: DecomposeReport | null } = { report: null }
  await machine.runStage('decompose', async () => {
    decompose.report = await runDecompose(
      { driver: deps.driver, agent, runDir: state.runDir, sidecarDir: ctx.sidecarDir, cwd: ctx.cwd },
      { changeName: state.changeName },
    )
  })
  state.stage = 'decompose'
  await saveRunState(state, nowOf(deps))
  if (decompose.report !== null && decompose.report.needs_split === true) return divertToSplitPlan(input)
  return runTailFromAtomicity(input)
}

/**
 * The tail's back half — atomicity (depth ≠ S) → final gate at `version` —
 * shared with the D6 continuation start, which re-enters here because its
 * slice is already decomposed (the split re-scoped tasks.md to child #1).
 */
export async function runTailFromAtomicity(input: PostConvergenceTailInput): Promise<RunStartResult> {
  const { deps, state, ctx, agent, depth, reviewResult, version } = input
  const machine = createStageMachine({ emit: ctx.emit })
  if (depth !== 'S') {
    await machine.runStage('atomicity', async () => {
      await runAtomicity(
        {
          driver: deps.driver,
          agent,
          runDir: state.runDir,
          sidecarDir: ctx.sidecarDir,
          cwd: ctx.cwd,
        },
        { changeName: state.changeName, depth },
      )
    })
    state.stage = 'atomicity'
    await saveRunState(state, nowOf(deps))
  }
  state.stage = 'gate'
  let gateResult!: RunStartResult
  await machine.runStage('gate', async () => {
    gateResult = await presentGateAt(deps, state, ctx, reviewResult, version, 'final')
  })
  return gateResult
}
