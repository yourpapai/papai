// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import pLimit from 'p-limit'
import { z } from 'zod'

import { agentWritePath } from '../../review-loop/src/agent-runner.js'
import { AssumptionRecordSchema, FindingsSidecarSchema, ResolutionSchema, runStageAgent } from './agent-layer.js'
import type { AgentLayerDeps, Finding, Resolution } from './agent-layer.js'
import type { DepthProfile, EventInput } from './events.js'
import {
  buildResolverPrompt,
  buildReviewerPrompt,
  evaluateConvergence,
  lensesForRound,
  mergeLensFindings,
  readResolutionsLedger,
  readReviewArtifacts,
  ROUND_CAPS,
} from './review-model.js'

export const ResolverOutputSchema = z.object({
  resolutions: z.array(ResolutionSchema),
  assumptions: z.array(AssumptionRecordSchema),
})
export type ResolverOutput = z.infer<typeof ResolverOutputSchema>

export interface ReviewLoopDeps {
  readonly agent: AgentLayerDeps
  readonly emit: (event: EventInput) => void
  readonly sidecarDir: string
  readonly cwd: string
  readonly materialize: (round: number) => Promise<void>
}

export interface ReviewLoopOptions {
  readonly changeName: string
  readonly changeDir: string
  readonly depth: DepthProfile
  readonly taskText: string
  readonly conventions: string
}

export interface ReviewLoopResult {
  readonly outcome: 'converged' | 'cap-hit'
  readonly rounds: number
  readonly openBlockers: readonly Resolution[]
}

async function runLens(
  deps: ReviewLoopDeps,
  options: ReviewLoopOptions,
  lens: 'reviewer' | 'skeptic',
  round: number,
  artifacts: string,
  ledger: readonly Resolution[],
): Promise<Finding[]> {
  const outputPath = lens === 'skeptic' ? `findings-skeptic-${round}.json` : `findings-${round}.json`
  const result = await runStageAgent(deps.agent, {
    role: lens,
    changeName: options.changeName,
    cwd: deps.cwd,
    prompt: buildReviewerPrompt({
      lens,
      artifacts,
      conventions: options.conventions,
      ledger,
      outputTarget: agentWritePath(deps.cwd, outputPath),
    }),
    outputPath,
    outputSchema: FindingsSidecarSchema,
    label: `${lens}-r${round}`,
    logPath: `${deps.sidecarDir}/logs/${lens}-r${round}.log`,
    sidecarDir: deps.sidecarDir,
  })
  return result.value.findings
}

async function runResolver(
  deps: ReviewLoopDeps,
  options: ReviewLoopOptions,
  round: number,
  artifacts: string,
  merged: readonly Finding[],
): Promise<ResolverOutput> {
  const result = await runStageAgent(deps.agent, {
    role: 'resolver',
    changeName: options.changeName,
    cwd: deps.cwd,
    prompt: buildResolverPrompt({
      artifacts,
      findings: merged,
      conventions: options.conventions,
      taskText: options.taskText,
      outputTarget: agentWritePath(deps.cwd, `resolutions-${round}.json`),
    }),
    outputPath: `resolutions-${round}.json`,
    outputSchema: ResolverOutputSchema,
    label: `resolver-r${round}`,
    logPath: `${deps.sidecarDir}/logs/resolver-r${round}.log`,
    sidecarDir: deps.sidecarDir,
  })
  for (const entry of result.value.resolutions) {
    const action = entry.resolution === 'dismissed' ? 'dismissed' : 'resolved'
    deps.emit({ altitude: 'L2', type: 'finding', action, id: entry.id, round, class: entry.class })
  }
  for (const assumption of result.value.assumptions) {
    deps.emit({ altitude: 'L2', type: 'assumption', action: 'logged', id: assumption.id })
  }
  return result.value
}

async function runRound(
  deps: ReviewLoopDeps,
  options: ReviewLoopOptions,
  round: number,
  cap: number,
  prevOpenBlockers: number,
): Promise<ReviewLoopResult> {
  deps.emit({ altitude: 'L2', type: 'round_open', round, cap })
  const artifacts = await readReviewArtifacts(options.changeDir)
  const ledger = await readResolutionsLedger(deps.sidecarDir, round)
  const lenses = lensesForRound(options.depth, round, prevOpenBlockers)
  const limit = pLimit(2)
  const perLens = await Promise.all(
    lenses.map((lens) => limit(() => runLens(deps, options, lens, round, artifacts, ledger))),
  )
  const merged = mergeLensFindings(...perLens)
  for (const finding of merged) {
    deps.emit({ altitude: 'L2', type: 'finding', action: 'classified', id: finding.id, round, class: finding.class })
  }
  const resolved = await runResolver(deps, options, round, artifacts, merged)
  const { verdict, counts } = evaluateConvergence(resolved.resolutions)
  deps.emit({ altitude: 'L2', type: 'convergence', round, verdict, counts })
  await deps.materialize(round)
  deps.emit({ altitude: 'L2', type: 'round_close', round, cap })
  if (verdict === 'converged') return { outcome: 'converged', rounds: round, openBlockers: [] }
  const openBlockers = resolved.resolutions.filter((entry) => entry.class === 'BLOCKER')
  if (round >= cap) return { outcome: 'cap-hit', rounds: round, openBlockers }
  return runRound(deps, options, round + 1, cap, openBlockers.length)
}

export function runReviewLoop(deps: ReviewLoopDeps, options: ReviewLoopOptions): Promise<ReviewLoopResult> {
  return runRound(deps, options, 1, ROUND_CAPS[options.depth], 0)
}
