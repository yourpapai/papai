// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { autonomyOf, deriveChangeName } from './config.js'
import { createAppendBoundary } from './drive/boundary.js'
import { drive } from './drive/loop.js'
import type { DriveResult, ParkedReason, WorkFor } from './drive/loop.js'
import { parkedReasonOf, resumeEventOf } from './drive/resume.js'
import { workForOf } from './graph/pipeline-work.js'
import { pipelineMachine } from './graph/pipeline.js'
import { foldRun, logPathOf, writeRunMemo } from './memo-project.js'
import type { MemoSeed } from './memo-project.js'
import { applyOwedRecovery, escalationPresenterOf } from './run-recovery.js'
import { loadRunState } from './run-state.js'
import type { RunDeps, RunHalt } from './run.js'
import { readSessionLedger } from './session-ledger.js'
import { createStopMarkerSeam, removeHolder, writeHolder } from './stop-controller.js'
import { awaitGateSettle } from './work/gate-waiter.js'

/**
 * The gate continuation loop (design D3): after a gate-pending park, wait in
 * the foreground waiter, settle, and re-drive — repeating while the run keeps
 * presenting gates. Shared by start and resume so a parked resume continues
 * identically.
 */
export async function waitSettledGates(
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

export function parkLine(parked: ParkedReason): string {
  if (parked === 'gate-pending') return 'run parked gate-pending — answer the presented gate'
  if (parked === 'stopped') return 'run stopped calmly — resume with afk-runner resume <runId>'
  return 'run reached a final — print the report with afk-runner report <runId>'
}

export interface ResumeOutcome extends RunHalt {
  /** True when the resume actually re-entered work; false reports an already-parked run. */
  readonly drove: boolean
}

/** The memo is read opportunistically for the change name only; a missing memo derives it from the run's task.md. */
export async function changeNameOf(deps: RunDeps, runId: string, runDir: string): Promise<string> {
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
    createdAt: createdAt ?? (deps.now?.() ?? new Date()).toISOString(),
    metered: autonomyOf(deps.config).metered,
  }
}

/**
 * Resume by replay (design D6/D7): a pure function of the event log plus the
 * session ledger — re-fold, heal the owed recovery artifacts, derive the
 * parked reason as data, and either re-enter the interrupted stage through
 * the same drive loop or report the park. No persisted state pointer is
 * consulted for control flow.
 *
 * One resume event per invocation (log-fidelity D3/D4): appended after the
 * owed recovery completes and before any work re-entry or park, classified
 * from the post-recovery fold plus the session ledger.
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
  createAppendBoundary(pipelineMachine, logPath, { now: deps.now }).append(
    resumeEventOf(workForAndInput.folded.context, workForAndInput.folded.position, readSessionLedger(runDir)),
  )
  if (workForAndInput.parked !== 'drivable') {
    const parkedPrepared: ResumePrepared & { parked: ParkedReason } = {
      ...workForAndInput,
      parked: workForAndInput.parked,
    }
    return parkResumedRun(deps, runId, runDir, logPath, parkedPrepared)
  }
  const result = await driveRunResume(
    deps,
    seedOf(deps, runId, workForAndInput.changeName, workForAndInput.folded.createdAt),
    { taskText: workForAndInput.taskText, changeName: workForAndInput.changeName },
    workForAndInput.workFor,
    runDir,
    logPath,
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

/** A drivable resume re-enters through the same drive + continuation loop a live start uses. */
async function driveRunResume(
  deps: RunDeps,
  seed: MemoSeed,
  input: { readonly taskText: string; readonly changeName: string },
  workFor: WorkFor,
  runDir: string,
  logPath: string,
): Promise<RunHalt> {
  // The calm-stop marker is the default stop seam (C6 D7): the stop verb is
  // its first producer; a drive honors it at the next boundary.
  const stop = deps.stop ?? createStopMarkerSeam(runDir)
  writeHolder(runDir)
  try {
    const initial: DriveResult = await drive(
      {
        machine: pipelineMachine,
        logPath,
        now: deps.now,
        escalation: escalationPresenterOf(deps, input, seed.runId),
        stop,
      },
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
