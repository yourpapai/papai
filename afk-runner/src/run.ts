// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { SpawnFn } from '../../review-loop/src/agent-runner.js'
import { deriveChangeName } from './config.js'
import type { ExecGitFn, RunnerConfig } from './config.js'
import { createAppendBoundary } from './drive/boundary.js'
import { drive } from './drive/loop.js'
import type { DriveResult, ParkedReason, StopSeam } from './drive/loop.js'
import { flattenPosition } from './drive/loop.js'
import { parkedReasonOf } from './drive/resume.js'
import type { DepthProfile } from './events.js'
import { readEvents } from './events.js'
import type { SddEvent } from './events.js'
import { STAGE_ORDER } from './events.js'
import type { StageId } from './events.js'
import { createPipelineWorkFor } from './graph/pipeline-work.js'
import { pipelineMachine } from './graph/pipeline.js'
import { foldEvents } from './kernel/fold.js'
import type { KernelContext } from './kernel/machine.js'
import type { OpenSpecDriver } from './openspec-driver.js'
import { createRunState, loadRunState, resolveRoundCap, saveRunState } from './run-state.js'
import type { RunState } from './run-state.js'
import { removeHolder, writeHolder } from './stop-controller.js'
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

interface MemoSeed {
  readonly runId: string
  readonly workDir: string
  readonly repoRoot: string
  readonly changeName: string
  readonly createdAt: string
}

function nowOf(deps: RunDeps): Date {
  return deps.now?.() ?? new Date()
}

function logPathOf(runDir: string): string {
  return path.join(runDir, 'events.ndjson')
}

function stageOf(position: string): StageId {
  const stage = STAGE_ORDER.find((entry) => entry === position)
  if (stage !== undefined) return stage
  return position === 'start' ? 'intake' : 'gate'
}

/**
 * The derived memo (design D6): written after appends as a pure projection of
 * the log — stage from the folded position, round and gate from context,
 * timestamps from the first and last events. Never read for control flow; a
 * missing or stale copy changes nothing.
 */
async function writeRunMemo(
  seed: MemoSeed,
  halted: ParkedReason,
  position: string,
  context: KernelContext,
  logPath: string,
): Promise<void> {
  const events = readEventsOf(logPath)
  const runDir = path.join(seed.workDir, 'runs', seed.runId)
  const memo: RunState = {
    runId: seed.runId,
    repoRoot: seed.repoRoot,
    workDir: seed.workDir,
    changeName: seed.changeName,
    stage: stageOf(position),
    depth: context.depth,
    round: context.round?.current ?? 0,
    roundCap: context.round?.cap ?? resolveRoundCap({ depth: context.depth }),
    gate: context.gate === null ? null : { mode: context.gate.mode, version: context.gate.version },
    status: halted === 'stopped' ? 'stopped' : 'running',
    createdAt: events[0]?.ts ?? seed.createdAt,
    updatedAt: events[events.length - 1]?.ts ?? seed.createdAt,
    runDir,
    statePath: path.join(runDir, 'state.json'),
  }
  await saveRunState(memo, new Date(memo.updatedAt))
}

function foldRun(logPath: string): {
  readonly context: KernelContext
  readonly position: string
  readonly createdAt: string | null
} {
  const events = readEventsOf(logPath)
  const snapshot = foldEvents(pipelineMachine, events).snapshot
  return {
    context: snapshot.context,
    position: flattenPosition(snapshot.value),
    createdAt: events[0]?.ts ?? null,
  }
}

function readEventsOf(logPath: string): readonly SddEvent[] {
  return existsSync(logPath) ? readEvents(logPath) : []
}

async function driveRun(
  deps: RunDeps,
  seed: MemoSeed,
  input: { readonly taskText: string; readonly changeName: string; readonly depthOverride?: DepthProfile },
): Promise<RunHalt> {
  const workFor = createPipelineWorkFor(
    {
      spawn: deps.spawn,
      execGit: deps.execGit,
      driver: deps.driver,
      config: deps.config,
      conventions: deps.conventions,
      stdout: deps.stdout,
      ...(deps.stop === undefined ? {} : { stop: deps.stop }),
    },
    input,
  )
  const runDir = path.join(seed.workDir, 'runs', seed.runId)
  const logPath = logPathOf(runDir)
  writeHolder(runDir)
  try {
    let result: DriveResult = await drive({ machine: pipelineMachine, logPath, now: deps.now }, workFor)
    while (result.parked === 'gate-pending' && deps.gateWait !== undefined) {
      await writeRunMemo(seed, result.parked, result.position, result.context, logPath)
      deps.stdout?.(parkLine(result.parked))
      const boundary = createAppendBoundary(pipelineMachine, logPath, { now: deps.now })
      const waited = await awaitGateSettle({
        runDir,
        logPath,
        sidecarDir: path.join(runDir, 'sidecars'),
        changeDir: path.join(deps.config.repoRoot, 'openspec', 'changes', input.changeName),
        machine: pipelineMachine,
        emit: boundary.append,
        tick: deps.gateWait.tick,
        ...(deps.stdout === undefined ? {} : { stdout: deps.stdout }),
      })
      if (waited.kind === 'external') deps.stdout?.('gate settled externally — re-evaluating')
      result = await drive({ machine: pipelineMachine, logPath, now: deps.now }, workFor)
    }
    await writeRunMemo(seed, result.parked, result.position, result.context, logPath)
    deps.stdout?.(parkLine(result.parked))
    return { runId: seed.runId, halted: result.parked, position: result.position }
  } finally {
    removeHolder(runDir)
  }
}

function parkLine(parked: ParkedReason): string {
  if (parked === 'gate-pending') return 'run parked gate-pending — answer the presented gate'
  if (parked === 'stopped') return 'run stopped calmly — resume with afk-runner resume <runId>'
  return 'run parked awaiting-tail — the tail stages land in C5'
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
 * Resume by replay (design D6): a pure function of the event log plus the
 * session ledger — re-fold, derive the parked reason as data, and either
 * re-enter the interrupted stage through the same drive loop or report the
 * park. No persisted state pointer is consulted for control flow.
 */
export async function resumeRun(deps: RunDeps, runId: string): Promise<ResumeOutcome> {
  const runDir = path.join(deps.config.workDir, 'runs', runId)
  const logPath = logPathOf(runDir)
  const folded = foldRun(logPath)
  const changeName = await changeNameOf(deps, runId, runDir)
  const taskText = await readFile(path.join(runDir, 'task.md'), 'utf8')
  const workFor = createPipelineWorkFor(
    {
      spawn: deps.spawn,
      execGit: deps.execGit,
      driver: deps.driver,
      config: deps.config,
      conventions: deps.conventions,
      stdout: deps.stdout,
    },
    { taskText, changeName },
  )
  const parked = parkedReasonOf(folded.context, folded.position, workFor)
  if (parked !== 'drivable') {
    const seed = seedOf(deps, runId, changeName, folded.createdAt)
    await writeRunMemo(seed, parked, folded.position, folded.context, logPath)
    deps.stdout?.(parkLine(parked))
    return { runId, halted: parked, position: folded.position, drove: false }
  }
  const result = await driveRun(deps, seedOf(deps, runId, changeName, folded.createdAt), { taskText, changeName })
  return { ...result, drove: true }
}

export interface RunStatus {
  readonly runId: string
  readonly position: string
  readonly context: KernelContext
  readonly parked: ParkedReason | 'drivable'
}

/** Status is a fold: the full derived state plus the parked reason as data. */
export async function statusRun(deps: RunDeps, runId: string): Promise<RunStatus> {
  const runDir = path.join(deps.config.workDir, 'runs', runId)
  const folded = foldRun(logPathOf(runDir))
  const changeName = await changeNameOf(deps, runId, runDir)
  const taskText = await readFile(path.join(runDir, 'task.md'), 'utf8')
  const workFor = createPipelineWorkFor(
    {
      spawn: deps.spawn,
      execGit: deps.execGit,
      driver: deps.driver,
      config: deps.config,
      conventions: deps.conventions,
    },
    { taskText, changeName },
  )
  return {
    runId,
    position: folded.position,
    context: folded.context,
    parked: parkedReasonOf(folded.context, folded.position, workFor),
  }
}
