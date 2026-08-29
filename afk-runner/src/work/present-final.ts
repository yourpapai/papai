// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'

import { autonomyOf } from '../config.js'
import type { RunnerConfig } from '../config.js'
import type { WorkIO } from '../drive/loop.js'
import { readEvents } from '../events.js'
import type { EventInput } from '../events.js'
import { pipelineMachine } from '../graph/pipeline.js'
import { foldEvents } from '../kernel/fold.js'
import type { KernelContext } from '../kernel/machine.js'
import { readChangeDigest } from './gate-digest-extract.js'
import { writeGateFiles } from './gate-files.js'
import { runGatePrelude } from './gate-prelude.js'
import { readReviewResultFromSidecars } from './gate-settle.js'
import { findingsOf, gatherGateSignals } from './gate-signals.js'
import type { ReviewLoopResult } from './review-loop.js'

export interface PresentFinalDeps {
  readonly config: RunnerConfig
  readonly repoRoot: string
  readonly changeName: string
}

export interface PresentFinalResult {
  readonly version: number
}

/**
 * The final-gate presentation as the tail's last work act (C5 D1/D2): render
 * the gate file + hashes sidecar FIRST, append `stage_enter(gate)` (the graph
 * moves into the gate compound), append the presented event at
 * max-presented+1, then run the autonomy ladder (which always logs). The
 * tail stage's bracket-closing exit lands from `gate.awaiting` afterwards —
 * loop mechanics, not this helper. File-first ordering makes every
 * pre-presentation crash heal via the state's self-loop (work re-runs, file
 * overwritten at the same version); only the entry↔presented gap needs the
 * resume-level owed-presentation recovery.
 */
/** The derivation half of the final-gate presentation: paths, fold, version, signals, findings, autonomy. */
async function finalGateContext(
  deps: PresentFinalDeps,
  io: WorkIO,
): Promise<{
  readonly runDir: string
  readonly logPath: string
  readonly sidecarDir: string
  readonly changeDir: string
  readonly version: number
  readonly round: number
  readonly emit: (event: EventInput) => void
  readonly signals: Awaited<ReturnType<typeof gatherGateSignals>>
  readonly autonomy: ReturnType<typeof autonomyOf>
  readonly deadlineAt: string | undefined
}> {
  const runDir = io.runDir
  const logPath = path.join(runDir, 'events.ndjson')
  const sidecarDir = path.join(runDir, 'sidecars')
  const changeDir = path.join(deps.repoRoot, 'openspec', 'changes', deps.changeName)
  const events = readEvents(logPath)
  const settled = foldEvents(pipelineMachine, events).snapshot.context
  const version = (settled.gate?.version ?? 0) + 1
  const round = settled.round?.current ?? 1
  const emit = (event: EventInput): void => {
    io.append(event)
  }
  const signals = await gatherGateSignals(
    sidecarDir,
    round,
    settled,
    events,
    events[0]?.ts ?? new Date().toISOString(),
    new Date(),
  )
  const autonomy = autonomyOf(deps.config)
  const deadlineAt =
    autonomy.deadlineMinutes === undefined
      ? undefined
      : new Date(Date.now() + autonomy.deadlineMinutes * 60_000).toISOString()
  return { runDir, logPath, sidecarDir, changeDir, version, round, emit, signals, autonomy, deadlineAt }
}

export async function presentFinalGate(deps: PresentFinalDeps, io: WorkIO): Promise<PresentFinalResult> {
  const { runDir, logPath, sidecarDir, changeDir, version, round, emit, signals, autonomy, deadlineAt } =
    await finalGateContext(deps, io)
  const reviewResult: ReviewLoopResult = await readReviewResultFromSidecars(sidecarDir, round, 'converged')
  const findings = findingsOf(reviewResult)
  await writeGateFiles(
    { emit: (): void => undefined, runDir, changeDir, driftCheck: () => Promise.resolve() },
    {
      version,
      mode: 'final',
      changeName: deps.changeName,
      runId: path.basename(runDir),
      assumptions: signals.assumptions,
      blockers: findings.blockers,
      openMaterial: findings.material,
      openNitpicks: findings.nitpicks,
      trajectory: signals.trajectory,
      capHitFired: false,
      summary: deps.changeName,
      costUsd: signals.costUsd,
      costKnown: signals.costKnown,
      durationMs: signals.durationMs,
      changeDigest: await readChangeDigest(changeDir),
    },
  )
  io.append({ altitude: 'L2', type: 'stage_enter', stage: 'gate' })
  io.append({
    altitude: 'L2',
    type: 'gate',
    action: 'presented',
    mode: 'final',
    version,
    ...(deadlineAt === undefined ? {} : { deadlineAt }),
  })
  await runGatePrelude({
    version,
    mode: 'final',
    reviewResult,
    context: refoldContext(logPath),
    events: readEvents(logPath),
    sidecarDir,
    changeDir,
    runDir,
    repoRoot: deps.repoRoot,
    emit,
    autonomy,
  })
  return { version }
}

function refoldContext(logPath: string): KernelContext {
  return foldEvents(pipelineMachine, readEvents(logPath)).snapshot.context
}
