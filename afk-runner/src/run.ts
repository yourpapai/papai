// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { SpawnFn } from '../../review-loop/src/agent-runner.js'
import { deriveChangeName, autonomyOf } from './config.js'
import type { ExecGitFn, RunnerConfig } from './config.js'
import { drive } from './drive/loop.js'
import type { DriveResult, ParkedReason, StopSeam } from './drive/loop.js'
import { parkedReasonOf } from './drive/resume.js'
import type { DepthProfile } from './events.js'
import { workForOf } from './graph/pipeline-work.js'
import { pipelineMachine } from './graph/pipeline.js'
import { foldRun, logPathOf, writeRunMemo } from './memo-project.js'
import type { MemoSeed } from './memo-project.js'
import type { OpenSpecDriver } from './openspec-driver.js'
import { escalationPresenterOf } from './run-recovery.js'
import { changeNameOf, parkLine, waitSettledGates } from './run-resume.js'
import { createRunState } from './run-state.js'
import { createStopMarkerSeam, removeHolder, writeHolder } from './stop-controller.js'

export interface RunDeps {
  readonly config: RunnerConfig
  readonly spawn: SpawnFn
  readonly execGit: ExecGitFn
  readonly driver: OpenSpecDriver
  readonly stdout?: (line: string) => void
  readonly conventions?: string
  readonly now?: () => Date
  /** Calm-stop seam honored by the review loop between rounds. */
  readonly stop?: StopSeam
  /**
   * Foreground gate waiter (C4 design D3): when present, a gate-pending park
   * keeps the process alive polling the gate file, steer file, and log —
   * settling through the seam and re-driving per outcome. Absent (tests,
   * embedders) the park returns immediately as before.
   */
  readonly gateWait?: { readonly tick: () => Promise<void> }
}

export interface RunHalt {
  readonly runId: string
  readonly halted: ParkedReason
  readonly position: string
}

export interface StartOptions {
  readonly taskFile?: string
  readonly taskText?: string
  readonly changeName?: string
  readonly depthOverride?: DepthProfile
}

function nowOf(deps: RunDeps): Date {
  return deps.now?.() ?? new Date()
}

async function driveRun(
  deps: RunDeps,
  seed: MemoSeed,
  input: { readonly taskText: string; readonly changeName: string; readonly depthOverride?: DepthProfile },
): Promise<RunHalt> {
  // The calm-stop marker is the default stop seam (C6 D7): the stop verb is
  // its first producer; a drive honors it at the next boundary.
  const runDir = path.join(seed.workDir, 'runs', seed.runId)
  const logPath = logPathOf(runDir)
  const stop = deps.stop ?? createStopMarkerSeam(runDir)
  const workFor = workForOf(deps, input)
  const escalation = escalationPresenterOf(deps, input, seed.runId)
  writeHolder(runDir)
  try {
    const initial: DriveResult = await drive(
      { machine: pipelineMachine, logPath, now: deps.now, escalation, stop },
      workFor,
    )
    const result = await waitSettledGates(deps, seed, input, runDir, logPath, workFor, initial)
    await writeRunMemo(seed, result.parked, result.position, result.context, logPath)
    deps.stdout?.(parkLine(result.parked))
    return { runId: seed.runId, halted: result.parked, position: result.position }
  } finally {
    removeHolder(runDir)
  }
}

export async function startRun(deps: RunDeps, options: StartOptions): Promise<RunHalt> {
  let taskText: string
  let changeName: string
  if (options.taskFile === undefined) {
    const text = options.taskText
    if (text === undefined) throw new Error('startRun requires a task file or inline task text')
    taskText = text
    changeName = options.changeName ?? deriveChangeName('task.md', taskText)
  } else {
    taskText = await readFile(options.taskFile, 'utf8')
    changeName = options.changeName ?? deriveChangeName(options.taskFile, taskText)
  }
  const now = nowOf(deps)
  const state = await createRunState(
    {
      workDir: deps.config.workDir,
      repoRoot: deps.config.repoRoot,
      changeName,
      metered: autonomyOf(deps.config).metered,
    },
    now,
  )
  await writeFile(path.join(state.runDir, 'task.md'), taskText, 'utf8')
  return driveRun(deps, state, { taskText, changeName, depthOverride: options.depthOverride })
}

export interface RunStatus {
  readonly runId: string
  readonly position: string
  readonly context: ReturnType<typeof foldRun>['context']
  readonly parked: ParkedReason | 'drivable'
}

/** Status is a fold: the full derived state plus the parked reason as data. */
export async function statusRun(deps: RunDeps, runId: string): Promise<RunStatus> {
  const runDir = path.join(deps.config.workDir, 'runs', runId)
  const folded = foldRun(logPathOf(runDir))
  const changeName = await changeNameOf(deps, runId, runDir)
  const taskText = await readFile(path.join(runDir, 'task.md'), 'utf8')
  const workFor = workForOf(deps, { taskText, changeName })
  return {
    runId,
    position: folded.position,
    context: folded.context,
    parked: parkedReasonOf(folded.context, folded.position, workFor),
  }
}
