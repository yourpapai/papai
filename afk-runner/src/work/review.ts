// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'

import type { SpawnFn } from '../../../review-loop/src/agent-runner.js'
import type { AgentLayerDeps } from '../agent-layer.js'
import type { ExecGitFn, RunnerConfig } from '../config.js'
import type { WorkIO } from '../drive/loop.js'
import { reviewResumeEntry } from '../drive/resume.js'
import type { DepthProfile, EventInput } from '../events.js'
import type { KernelContext } from '../kernel/machine.js'
import { ROUND_CAPS } from '../run-state.js'
import { readSessionLedger } from '../session-ledger.js'
import { createMaterializer } from './materialize.js'
import { runReviewLoop } from './review-loop.js'
import type { ReviewLoopResult } from './review-loop.js'

export type ReviewOutcome = 'converged' | 'cap-hit' | 'incomplete'

/**
 * The review outcome as a pure reader of folded context: an unanswered gate
 * parks cap-hit (an answered one releases continuation — the extend path
 * never clears the gate record, so answered gates must not re-park); a
 * converged verdict — including the severity rule (a nitpick-only open
 * cap-hit counts as converged, mirroring the legacy orchestrator) — or a
 * passed review stage is converged; anything else means the loop still owes
 * work (fresh, crashed mid-round, or calm-stopped).
 */
export function reviewOutcomeOf(context: KernelContext): ReviewOutcome {
  if (context.gate !== null && !context.gate.answered) return 'cap-hit'
  const verdict = context.lastVerdict
  if (
    verdict !== null &&
    (verdict.verdict === 'converged' || (verdict.counts.blocker === 0 && verdict.counts.material === 0))
  ) {
    return 'converged'
  }
  const decompose = context.stages['decompose']
  if (decompose === 'done' || decompose === 'active') return 'converged'
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
 * The review work module body: the legacy review loop recursion stays inside;
 * rounds emit their domain events through the validated append; the re-entry
 * point derives from folded context plus the session ledger; a blocking
 * cap-hit appends the presented early gate and the run parks gate-pending.
 */
export async function runReviewWork(input: ReviewWorkInput, io: WorkIO): Promise<ReviewLoopResult> {
  const emit = (event: EventInput): void => {
    io.append(event)
  }
  const runDir = io.runDir
  const sidecarDir = path.join(runDir, 'sidecars')
  const changeDir = path.join(input.repoRoot, 'openspec', 'changes', input.changeName)
  const materialize = createMaterializer(sidecarDir, changeDir, emit, input.repoRoot)
  const depth: DepthProfile = io.context.depth ?? 'S'
  const entry = reviewResumeEntry(io.context, readSessionLedger(runDir), depth)
  const agent: AgentLayerDeps = {
    spawn: input.agent.spawn,
    config: input.agent.config,
    execGit: input.agent.execGit,
    emit,
  }
  const result = await runReviewLoop(
    {
      agent,
      emit,
      runDir,
      sidecarDir,
      cwd: input.repoRoot,
      materialize,
      ...(input.stop === undefined ? {} : { stop: input.stop }),
      ...(entry.resumeSession === undefined ? {} : { resumeSession: entry.resumeSession }),
      steer: {
        runDir,
        onWarning: input.onSteerWarning ?? ((): void => undefined),
        readRoundCap: (): number => io.context.round?.cap ?? ROUND_CAPS[depth],
      },
    },
    {
      changeName: input.changeName,
      changeDir,
      depth,
      taskText: input.taskText,
      conventions: input.conventions,
    },
    { startRound: entry.startRound, cap: entry.cap },
  )
  if (presentsGate(result)) {
    const version = (io.context.gate?.version ?? 0) + 1
    emit({ altitude: 'L2', type: 'gate', action: 'presented', mode: 'early', version })
  }
  return result
}
