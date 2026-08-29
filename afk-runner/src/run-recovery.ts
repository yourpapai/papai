// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'

import type { SpawnFn } from '../../review-loop/src/agent-runner.js'
import { autonomyOf } from './config.js'
import type { RunnerConfig } from './config.js'
import { createAppendBoundary } from './drive/boundary.js'
import type { WorkIO } from './drive/loop.js'
import { owedEscalationPresentationOf, owedMoversOf, owedPresentationOf, refoldedContext } from './drive/resume.js'
import type { EventInput, SddEvent } from './events.js'
import { readEvents } from './events.js'
import { pipelineMachine } from './graph/pipeline.js'
import { runGatePrelude } from './work/gate-prelude.js'
import { readReviewResultFromSidecars } from './work/gate-settle.js'
import { presentEscalationGate } from './work/present-escalation.js'

/** The recovery-facing slice of RunDeps (start/resume share these seams). */
export interface RecoveryDeps {
  readonly config: RunnerConfig
  readonly spawn: SpawnFn
  readonly now?: () => Date
}

/** The loop's escalation presenter (C6 D4): renders the gate, moves position, runs the ladder. */
export function escalationPresenterOf(
  deps: RecoveryDeps,
  input: { readonly changeName: string },
  runId: string,
): { readonly present: (io: WorkIO, stage: string) => Promise<void> } {
  return {
    present: async (io, stage) => {
      await presentEscalationGate(
        { config: deps.config, repoRoot: deps.config.repoRoot, changeName: input.changeName, runId },
        io,
        stage,
      )
    },
  }
}

/**
 * Owed-presentation recovery (C5 D5): append the presented event the crashed
 * presenter never landed (at the file-scan version) and re-run the ladder —
 * which may itself settle through the seam. Pure recovery: no work re-enters,
 * the run parks gate-pending right after unless the ladder decided.
 */
export async function recoverOwedPresentation(
  deps: RecoveryDeps,
  runDir: string,
  logPath: string,
  changeName: string,
  presented: { readonly version: number },
): Promise<void> {
  const boundary = createAppendBoundary(pipelineMachine, logPath, { now: deps.now })
  const emit = (event: Parameters<typeof boundary.append>[0]): void => {
    boundary.append(event)
  }
  const sidecarDir = path.join(runDir, 'sidecars')
  const changeDir = path.join(deps.config.repoRoot, 'openspec', 'changes', changeName)
  const context = refoldedContext(logPath)
  const round = context.round?.current ?? 1
  await runGatePrelude({
    version: presented.version,
    mode: 'final',
    reviewResult: await readReviewResultFromSidecars(sidecarDir, round, 'converged'),
    context,
    events: readEvents(logPath),
    sidecarDir,
    changeDir,
    runDir,
    repoRoot: deps.config.repoRoot,
    emit,
    autonomy: autonomyOf(deps.config),
  })
}

/**
 * Owed escalation-presentation recovery (C6 D10, W5/W6): files present —
 * append the owed presented event at the on-disk file version and re-run the
 * ladder (which always logs; never auto-settles); files absent — fresh-render
 * through the presenter itself. Pure recovery: the run parks gate-pending
 * right after unless the ladder decided (it cannot).
 */
export async function recoverOwedEscalation(
  deps: RecoveryDeps,
  runDir: string,
  logPath: string,
  changeName: string,
  owed: { readonly stage: string; readonly version: number | null },
): Promise<void> {
  const boundary = createAppendBoundary(pipelineMachine, logPath, { now: deps.now })
  const emit = (event: EventInput): SddEvent => boundary.append(event)
  const context = refoldedContext(logPath)
  if (owed.version === null) {
    await presentEscalationGate(
      { config: deps.config, repoRoot: deps.config.repoRoot, changeName, runId: path.basename(runDir) },
      { append: emit, context, runDir },
      owed.stage,
    )
    return
  }
  boundary.append({ altitude: 'L2', type: 'gate', action: 'presented', mode: 'escalation', version: owed.version })
  await runGatePrelude({
    version: owed.version,
    mode: 'escalation',
    reviewResult: {
      outcome: 'converged',
      rounds: context.round?.current ?? 1,
      openBlockers: [],
      openMaterial: [],
      openNitpicks: [],
    },
    context,
    events: readEvents(logPath),
    sidecarDir: path.join(runDir, 'sidecars'),
    changeDir: path.join(deps.config.repoRoot, 'openspec', 'changes', changeName),
    runDir,
    repoRoot: deps.config.repoRoot,
    emit: (event) => {
      emit(event)
    },
    autonomy: autonomyOf(deps.config),
  })
}

export interface FoldedRun {
  readonly context: ReturnType<typeof refoldedContext>
  readonly position: string
  readonly createdAt: string | null
}

/**
 * The resume owed-recovery block (extracted from resumeRun): heal the owed
 * presentation, the owed escalation, and the owed movers — each step re-folds
 * the log before the next derives from it. Returns the post-recovery fold.
 */
export async function applyOwedRecovery(
  deps: RecoveryDeps,
  runId: string,
  runDir: string,
  logPath: string,
  folded: FoldedRun,
  changeNameOf: (runId: string, runDir: string) => Promise<string>,
  foldAgain: () => FoldedRun,
): Promise<FoldedRun> {
  let current = folded
  const owedPresentation = owedPresentationOf(current.context, current.position, runDir)
  if (owedPresentation !== null && owedPresentation.type === 'gate') {
    const boundary = createAppendBoundary(pipelineMachine, logPath, { now: deps.now })
    boundary.append(owedPresentation)
    const changeNameForRecovery = await changeNameOf(runId, runDir)
    await recoverOwedPresentation(deps, runDir, logPath, changeNameForRecovery, {
      version: owedPresentation.version,
    })
    current = foldAgain()
  }
  const owedEscalation = owedEscalationPresentationOf(current.context, current.position, runDir)
  if (owedEscalation !== null) {
    const changeNameForRecovery = await changeNameOf(runId, runDir)
    await recoverOwedEscalation(deps, runDir, logPath, changeNameForRecovery, owedEscalation)
    current = foldAgain()
  }
  const owed = owedMoversOf(current.context, current.position)
  if (owed.length > 0) {
    const boundary = createAppendBoundary(pipelineMachine, logPath, { now: deps.now })
    for (const event of owed) boundary.append(event)
    current = foldAgain()
  }
  return current
}
