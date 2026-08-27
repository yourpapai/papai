// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { AgentLayerDeps } from './agent-layer.js'
import { runPlanBranch } from './children.js'
import { runAtomicity, runDecompose } from './decompose.js'
import type { DecomposeReport } from './decompose.js'
import type { DepthProfile } from './events.js'
import { readChangeDigest } from './gate-digest-extract.js'
import { nowOf, presentGateAt } from './gate-digest.js'
import type { OrchestratorDeps, RunStartResult, StageContext } from './gate-digest.js'
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
}

/**
 * Post-review routing: severity-converged and plain-converged outcomes run
 * the shared post-convergence tail; an open cap-hit presents the early gate.
 */
export function runPostReviewToGate(input: PostConvergenceTailInput): Promise<RunStartResult> {
  const reviewResult = input.reviewResult
  if (isSeverityConverged(reviewResult)) return runPostConvergenceTail(input)
  if (reviewResult.outcome === 'cap-hit') {
    return presentGateAt(input.deps, input.state, input.ctx, reviewResult, input.version, 'early')
  }
  return runPostConvergenceTail(input)
}

/**
 * Severity-based convergence (orchestrator-level verdict): a cap-hit round
 * with zero open BLOCKERs and zero open MATERIALs — nitpicks only, each
 * resolved or dismissed — is treated as converged and flows into decompose
 * without an early gate. Blockers/materials still force the early gate.
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
  return runPlanBranch(deps, state, ctx, pinned)
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
export async function runPostConvergenceTail(input: PostConvergenceTailInput): Promise<RunStartResult> {
  const { deps, state, ctx, agent, depth, reviewResult, version } = input
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
