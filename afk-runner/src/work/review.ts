// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'

import type { SpawnFn } from '../../../review-loop/src/agent-runner.js'
import type { AgentLayerDeps } from '../agent-layer.js'
import { autonomyOf } from '../config.js'
import type { ExecGitFn, RunnerConfig } from '../config.js'
import type { WorkIO } from '../drive/loop.js'
import { reviewResumeEntry } from '../drive/resume.js'
import { readEvents } from '../events.js'
import type { DepthProfile, EventInput } from '../events.js'
import { pipelineMachine } from '../graph/pipeline.js'
import { foldEvents } from '../kernel/fold.js'
import type { KernelContext } from '../kernel/machine.js'
import { ROUND_CAPS } from '../run-state.js'
import { readSessionLedger } from '../session-ledger.js'
import { readChangeDigest } from './gate-digest-extract.js'
import { presentGate } from './gate-files.js'
import { runGatePrelude } from './gate-prelude.js'
import { findingsOf, gatherGateSignals } from './gate-signals.js'
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
 * cap-hit presents the full early gate (gate MD + hashes sidecar + presented
 * event) and the run parks gate-pending.
 */
export async function runReviewWork(input: ReviewWorkInput, io: WorkIO): Promise<ReviewLoopResult> {
  const emit = (event: EventInput): void => {
    io.append(event)
  }
  const runDir = io.runDir
  const logPath = path.join(runDir, 'events.ndjson')
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
    await presentEarlyGate(input, io, { sidecarDir, changeDir, logPath, emit, runDir }, result)
  }
  return result
}

/** Cap-hit presentation: full gate digest + hashes sidecar + presented event + the ladder prelude (design D5/D6). */
async function presentEarlyGate(
  input: ReviewWorkInput,
  io: WorkIO,
  paths: { sidecarDir: string; changeDir: string; logPath: string; emit: (event: EventInput) => void; runDir: string },
  result: ReviewLoopResult,
): Promise<void> {
  const version = (io.context.gate?.version ?? 0) + 1
  const events = readEvents(paths.logPath)
  // Fold is truth: the rounds just appended changed the derived state the
  // digest (trajectory) and the ladder (per-round digests, cap) consume.
  const settled = foldEvents(pipelineMachine, events).snapshot.context
  const signals = await gatherGateSignals(
    paths.sidecarDir,
    result.rounds,
    settled,
    events,
    events[0]?.ts ?? new Date().toISOString(),
    new Date(),
  )
  const findings = findingsOf(result)
  const autonomy = autonomyOf(input.agent.config)
  const deadlineAt =
    autonomy.deadlineMinutes === undefined
      ? undefined
      : new Date(Date.now() + autonomy.deadlineMinutes * 60_000).toISOString()
  await presentGate(
    { emit: paths.emit, runDir: paths.runDir, changeDir: paths.changeDir, driftCheck: () => Promise.resolve() },
    {
      version,
      mode: 'early',
      changeName: input.changeName,
      runId: path.basename(paths.runDir),
      assumptions: signals.assumptions,
      blockers: findings.blockers,
      openMaterial: findings.material,
      openNitpicks: findings.nitpicks,
      trajectory: signals.trajectory,
      capHitFired: true,
      summary: input.changeName,
      costUsd: signals.costUsd,
      costKnown: signals.costKnown,
      durationMs: signals.durationMs,
      changeDigest: await readChangeDigest(paths.changeDir),
    },
    ...(deadlineAt === undefined ? [{}] : [{ deadlineAt }]),
  )
  await runGatePrelude({
    version,
    mode: 'early',
    reviewResult: result,
    context: settled,
    events,
    sidecarDir: paths.sidecarDir,
    changeDir: paths.changeDir,
    runDir: paths.runDir,
    repoRoot: input.repoRoot,
    emit: paths.emit,
    autonomy,
  })
}
