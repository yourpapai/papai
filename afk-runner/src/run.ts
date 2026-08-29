// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { SpawnFn } from '../../review-loop/src/agent-runner.js'
import { deriveChangeName } from './config.js'
import type { ExecGitFn, RunnerConfig } from './config.js'
import { createAppendBoundary } from './drive/boundary.js'
import { drive } from './drive/loop.js'
import type { DriveResult, ParkedReason, StopSeam, WorkFor } from './drive/loop.js'
import { parkedReasonOf } from './drive/resume.js'
import type { DepthProfile } from './events.js'
import { workForOf } from './graph/pipeline-work.js'
import { pipelineMachine } from './graph/pipeline.js'
import { foldRun, logPathOf, writeRunMemo } from './memo-project.js'
import type { MemoSeed } from './memo-project.js'
import type { OpenSpecDriver } from './openspec-driver.js'
import { applyOwedRecovery, escalationPresenterOf } from './run-recovery.js'
import { createRunState, loadRunState } from './run-state.js'
import { createStopMarkerSeam, removeHolder, writeHolder } from './stop-controller.js'
import { awaitGateSettle } from './work/gate-waiter.js'

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
  const stop = deps.stop ?? createStopMarkerSeam(runDir)
  const workFor = workForOf(deps, input)
  const logPath = logPathOf(runDir)
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

/**
 * The gate continuation loop (design D3): after a gate-pending park, wait in
 * the foreground waiter, settle, and re-drive — repeating while the run keeps
 * presenting gates. Shared by start and resume so a parked resume continues
 * identically.
 */
async function waitSettledGates(
  deps: RunDeps,
  seed: MemoSeed,
  input: { readonly taskText: string; readonly changeName: string },
  runDir: string,
  logPath: string,
  workFor: WorkFor,
  current: DriveResult,
): Promise<DriveResult> {
  if (current.parked !== 'gate-pending' || deps.gateWait === undefined) return current
  await writeRunMemo(seed, current.parked, current.position, current.context, logPath)
  deps.stdout?.(parkLine(current.parked))
  const boundary = createAppendBoundary(pipelineMachine, logPath, { now: deps.now })
  const waited = await awaitGateSettle({
    runDir,
    logPath,
    sidecarDir: path.join(runDir, 'sidecars'),
    changeDir: path.join(deps.config.repoRoot, 'openspec', 'changes', input.changeName),
    machine: pipelineMachine,
    emit: (event) => {
      boundary.append(event)
    },
    tick: deps.gateWait.tick,
    ...(deps.stdout === undefined ? {} : { stdout: deps.stdout }),
  })
  if (waited.kind === 'external') deps.stdout?.('gate settled externally — re-evaluating')
  const escalation = escalationPresenterOf(deps, input, seed.runId)
  const result = await drive({ machine: pipelineMachine, logPath, now: deps.now, escalation }, workFor)
  return waitSettledGates(deps, seed, input, runDir, logPath, workFor, result)
}

function parkLine(parked: ParkedReason): string {
  if (parked === 'gate-pending') return 'run parked gate-pending — answer the presented gate'
  if (parked === 'stopped') return 'run stopped calmly — resume with afk-runner resume <runId>'
  return 'run reached a final — print the report with afk-runner report <runId>'
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
  const state = await createRunState({ workDir: deps.config.workDir, repoRoot: deps.config.repoRoot, changeName }, now)
  await writeFile(path.join(state.runDir, 'task.md'), taskText, 'utf8')
  return driveRun(deps, state, { taskText, changeName, depthOverride: options.depthOverride })
}

export interface ResumeOutcome extends RunHalt {
  /** True when the resume actually re-entered work; false reports an already-parked run. */
  readonly drove: boolean
}

/** The memo is read opportunistically for the change name only; a missing memo derives it from the run's task.md. */
async function changeNameOf(deps: RunDeps, runId: string, runDir: string): Promise<string> {
  try {
    return (await loadRunState(deps.config.workDir, runId)).changeName
  } catch {
    return deriveChangeName('task.md', await readFile(path.join(runDir, 'task.md'), 'utf8'))
  }
}

function seedOf(deps: RunDeps, runId: string, changeName: string, createdAt: string | null): MemoSeed {
  return {
    runId,
    workDir: deps.config.workDir,
    repoRoot: deps.config.repoRoot,
    changeName,
    createdAt: createdAt ?? nowOf(deps).toISOString(),
  }
}

/**
 * Resume by replay (design D6/D7): a pure function of the event log plus the
 * session ledger — re-fold, heal the owed recovery artifacts, derive the
 * parked reason as data, and either re-enter the interrupted stage through
 * the same drive loop or report the park. No persisted state pointer is
 * consulted for control flow.
 *
 * W4 (accepted risk): a crash between the presented event and the ladder's
 * `auto_decision` record loses only that record — the gate settles normally
 * on the next producer. Re-running the ladder there is NOT safe: a second
 * R2 record would double-count against the auto-extend allowance, and the
 * window is milliseconds wide.
 */
export async function resumeRun(deps: RunDeps, runId: string): Promise<ResumeOutcome> {
  const runDir = path.join(deps.config.workDir, 'runs', runId)
  const logPath = logPathOf(runDir)
  const workForAndInput = await resumeInputs(deps, runId, runDir, logPath)
  if (workForAndInput.parked !== 'drivable') {
    const parkedPrepared: ResumePrepared & { parked: ParkedReason } = {
      ...workForAndInput,
      parked: workForAndInput.parked,
    }
    return parkResumedRun(deps, runId, runDir, logPath, parkedPrepared)
  }
  const result = await driveRun(
    deps,
    seedOf(deps, runId, workForAndInput.changeName, workForAndInput.folded.createdAt),
    {
      taskText: workForAndInput.taskText,
      changeName: workForAndInput.changeName,
    },
  )
  return { ...result, drove: true }
}

interface ResumePrepared {
  readonly folded: ReturnType<typeof foldRun>
  readonly taskText: string
  readonly changeName: string
  readonly workFor: WorkFor
  readonly parked: ParkedReason | 'drivable'
}

/** The shared resume derivation: owed recovery first, then the parked reason as data. */
async function resumeInputs(deps: RunDeps, runId: string, runDir: string, logPath: string): Promise<ResumePrepared> {
  const foldedAfterRecovery = await applyOwedRecovery(
    deps,
    runId,
    runDir,
    logPath,
    foldRun(logPath),
    (id, dir) => changeNameOf(deps, id, dir),
    () => foldRun(logPath),
  )
  const changeName = await changeNameOf(deps, runId, runDir)
  const taskText = await readFile(path.join(runDir, 'task.md'), 'utf8')
  const workFor = workForOf(deps, { taskText, changeName })
  const parked = parkedReasonOf(foldedAfterRecovery.context, foldedAfterRecovery.position, workFor)
  return { folded: foldedAfterRecovery, taskText, changeName, workFor, parked }
}

/** A parked resume either waits in the foreground continuation (gates) or reports the park. */
async function parkResumedRun(
  deps: RunDeps,
  runId: string,
  runDir: string,
  logPath: string,
  prepared: ResumePrepared & { readonly parked: ParkedReason },
): Promise<ResumeOutcome> {
  const seed = seedOf(deps, runId, prepared.changeName, prepared.folded.createdAt)
  if (prepared.parked === 'gate-pending' && deps.gateWait !== undefined) {
    // A parked gate resumes into the same foreground continuation a live
    // drive uses: wait for the settle, then continue per outcome.
    writeHolder(runDir)
    try {
      const initial: DriveResult = {
        position: prepared.folded.position,
        context: prepared.folded.context,
        parked: 'gate-pending',
      }
      const result = await waitSettledGates(
        deps,
        seed,
        { taskText: prepared.taskText, changeName: prepared.changeName },
        runDir,
        logPath,
        prepared.workFor,
        initial,
      )
      await writeRunMemo(seed, result.parked, result.position, result.context, logPath)
      deps.stdout?.(parkLine(result.parked))
      return { runId, halted: result.parked, position: result.position, drove: result.parked !== 'gate-pending' }
    } finally {
      removeHolder(runDir)
    }
  }
  await writeRunMemo(seed, prepared.parked, prepared.folded.position, prepared.folded.context, logPath)
  deps.stdout?.(parkLine(prepared.parked))
  return { runId, halted: prepared.parked, position: prepared.folded.position, drove: false }
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
