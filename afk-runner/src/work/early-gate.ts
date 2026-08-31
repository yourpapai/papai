// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'

import { autonomyOf } from '../config.js'
import type { RunnerConfig } from '../config.js'
import type { WorkIO } from '../drive/loop.js'
import { readEvents } from '../events.js'
import type { EventInput, SddEvent } from '../events.js'
import { pipelineMachine } from '../graph/pipeline.js'
import { foldEvents } from '../kernel/fold.js'
import type { KernelContext } from '../kernel/machine.js'
import { readChangeDigest } from './gate-digest-extract.js'
import { presentGate } from './gate-files.js'
import { runGatePrelude } from './gate-prelude.js'
import { findingsOf, gatherGateSignals } from './gate-signals.js'
import type { ReviewLoopResult } from './review-loop.js'

/** Cap-hit presentation paths shared by the review work module (design D5/D6). */
export interface EarlyGatePaths {
  readonly sidecarDir: string
  readonly changeDir: string
  readonly logPath: string
  readonly emit: (event: EventInput) => void
  readonly runDir: string
}

/** The derivation half of the cap-hit presentation: fold, version, signals, findings, autonomy, deadline. */
async function earlyGateContext(
  config: RunnerConfig,
  io: WorkIO,
  paths: EarlyGatePaths,
  result: ReviewLoopResult,
): Promise<{
  readonly version: number
  readonly settled: KernelContext
  readonly events: readonly SddEvent[]
  readonly signals: Awaited<ReturnType<typeof gatherGateSignals>>
  readonly autonomy: ReturnType<typeof autonomyOf>
  readonly deadlineAt: string | undefined
}> {
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
  const autonomy = autonomyOf(config)
  const deadlineAt =
    autonomy.deadlineMinutes === undefined
      ? undefined
      : new Date(Date.now() + autonomy.deadlineMinutes * 60_000).toISOString()
  return { version, settled, events, signals, autonomy, deadlineAt }
}

/** Cap-hit presentation: full gate digest + hashes sidecar + presented event + the ladder prelude (design D5/D6). */
export async function presentEarlyGate(
  input: { readonly agent: { readonly config: RunnerConfig }; readonly changeName: string; readonly repoRoot: string },
  io: WorkIO,
  paths: EarlyGatePaths,
  result: ReviewLoopResult,
): Promise<void> {
  const { version, settled, events, signals, autonomy, deadlineAt } = await earlyGateContext(
    input.agent.config,
    io,
    paths,
    result,
  )
  const findings = findingsOf(result)
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
