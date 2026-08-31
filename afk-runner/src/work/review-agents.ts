// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import pLimit from 'p-limit'

import { agentWritePath } from '../../../review-loop/src/agent-runner.js'
import { FindingsSidecarSchema, runStageAgent, SkepticFindingsSidecarSchema } from '../agent-layer.js'
import type { Finding } from '../agent-layer.js'
import type { EventInput } from '../events.js'
import { consistencyFindings } from './artifact-consistency.js'
import { fingerprintOf } from './concern-model.js'
import type { LedgerEntry } from './concern-model.js'
import { sessionForLabel } from './review-boundary.js'
import { ResolverOutputSchema } from './review-loop.js'
import type { ResolverOutput, ReviewLoopDeps, ReviewLoopOptions } from './review-loop.js'
import {
  lensesForRound,
  mergeLensFindings,
  readResolutionsLedger,
  readReviewArtifactFiles,
  readReviewArtifacts,
} from './review-model.js'
import { buildResolverPrompt, buildReviewerPrompt } from './review-prompt.js'

async function runLens(
  deps: ReviewLoopDeps,
  options: ReviewLoopOptions,
  lens: 'reviewer' | 'skeptic',
  round: number,
  artifacts: string,
  ledger: readonly LedgerEntry[],
  continueSessionId?: string,
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
    outputSchema: lens === 'skeptic' ? SkepticFindingsSidecarSchema : FindingsSidecarSchema,
    label: `${lens}-r${round}`,
    runDir: deps.runDir,
    round,
    sidecarDir: deps.sidecarDir,
    ...(continueSessionId === undefined ? {} : { continueSessionId }),
  })
  return result.value.findings
}

async function runResolver(
  deps: ReviewLoopDeps,
  options: ReviewLoopOptions,
  round: number,
  artifacts: string,
  merged: readonly Finding[],
  continueSessionId?: string,
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
    runDir: deps.runDir,
    round,
    sidecarDir: deps.sidecarDir,
    ...(continueSessionId === undefined ? {} : { continueSessionId }),
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

/** Run this round's lenses (bounded 2-way) and merge their findings. */
export async function runLenses(
  deps: ReviewLoopDeps,
  options: ReviewLoopOptions,
  round: number,
  prevOpenBlockers: number,
  consumedSession: ReviewLoopDeps['resumeSession'],
): Promise<readonly Finding[]> {
  const artifacts = await readReviewArtifacts(options.changeDir)
  const ledger = await readResolutionsLedger(deps.sidecarDir, round)
  const lenses = lensesForRound(options.depth, round, prevOpenBlockers)
  const limit = pLimit(2)
  const perLens = await Promise.all(
    lenses.map((lens) =>
      limit(() =>
        runLens(deps, options, lens, round, artifacts, ledger, sessionForLabel(consumedSession, lens, round)),
      ),
    ),
  )
  // Consistency injection (loop-memory D7): the deterministic cross-artifact
  // scan's synthesized findings ride the normal merge point, so the resolver
  // answers them like any lens finding — and a persistent disagreement a
  // resolver keeps waving off ends as thrash (D8).
  const consistency = consistencyFindings(await readReviewArtifactFiles(options.changeDir))
  return [...mergeLensFindings(...perLens), ...consistency]
}

/** Resolve this round's merged findings through the resolver spawn. */
export function resolveRound(
  deps: ReviewLoopDeps,
  options: ReviewLoopOptions,
  round: number,
  merged: readonly Finding[],
  consumedSession: ReviewLoopDeps['resumeSession'],
): Promise<ResolverOutput> {
  const consumed = consumedSession
  return readReviewArtifacts(options.changeDir).then((artifacts) =>
    runResolver(deps, options, round, artifacts, merged, sessionForLabel(consumed, 'resolver', round)),
  )
}

/** Emit the round's classified findings with their concern fingerprints (loop-memory D5). */
export function emitClassified(deps: ReviewLoopDeps, merged: readonly Finding[], round: number): void {
  for (const finding of merged) {
    const event: EventInput = {
      altitude: 'L2',
      type: 'finding',
      action: 'classified',
      id: finding.id,
      round,
      class: finding.class,
      fingerprint: fingerprintOf(finding.gap),
    }
    deps.emit(event)
  }
}
