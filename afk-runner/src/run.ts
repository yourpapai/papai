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
import { autonomyOf } from './config.js'
import { createAppendBoundary } from './drive/boundary.js'
import { drive } from './drive/loop.js'
import type { DriveResult, ParkedReason, StopSeam, WorkFor, WorkIO } from './drive/loop.js'
import { flattenPosition } from './drive/loop.js'
import {
  owedEscalationPresentationOf,
  owedMoversOf,
  owedPresentationOf,
  parkedReasonOf,
  refoldedContext,
} from './drive/resume.js'
import type { DepthProfile, EventInput } from './events.js'
import { readEvents } from './events.js'
import type { SddEvent } from './events.js'
import type { StageId } from './events.js'
import { createPipelineWorkFor } from './graph/pipeline-work.js'
import { pipelineMachine } from './graph/pipeline.js'
import { foldEvents } from './kernel/fold.js'
import type { KernelContext } from './kernel/machine.js'
import type { OpenSpecDriver } from './openspec-driver.js'
import { createRunState, loadRunState, resolveRoundCap, saveRunState } from './run-state.js'
import type { RunState } from './run-state.js'
import { createStopMarkerSeam, removeHolder, requestCalmStop, runHasLiveOwner, writeHolder } from './stop-controller.js'
import { runGatePrelude } from './work/gate-prelude.js'
import { readReviewResultFromSidecars } from './work/gate-settle.js'
import { awaitGateSettle } from './work/gate-waiter.js'
import { presentEscalationGate } from './work/present-escalation.js'

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

/**
 * Terminal parks map to the memo's terminal statuses (C5 D6): session-id
 * release follows through TERMINAL_STATUSES. C6 D8: an abort settled at an
 * escalation gate is failure-caused terminal — the dormant `failed` status
 * finally means something (the agent couldn't do the job) vs `aborted` (a
 * human chose to stop).
 */
function memoStatusOf(
  halted: ParkedReason,
  position: string,
  failureCaused: boolean,
): 'running' | 'stopped' | 'completed' | 'aborted' | 'failed' {
  if (halted === 'final' && position === 'aborted') return failureCaused ? 'failed' : 'aborted'
  if (halted === 'final') return 'completed'
  if (halted === 'stopped') return 'stopped'
  return 'running'
}

export interface MemoFields {
  readonly stage: StageId
  readonly depth: KernelContext['depth']
  readonly round: number
  readonly roundCap: number
  readonly gate: { readonly mode: 'early' | 'final' | 'plan' | 'escalation'; readonly version: number } | null
  readonly status: 'running' | 'stopped' | 'completed' | 'aborted' | 'failed'
  readonly createdAt: string
  readonly updatedAt: string
  readonly autoExtendsUsed: number
  readonly gateDeadlineAt: string | null
  readonly gateDeadlineReArmed: boolean
  readonly plan: { readonly childCount: number; readonly digest: string } | null
  readonly children: Readonly<Record<string, { readonly status: 'pending' | 'running' | 'done' | 'failed' }>> | null
}

/** The last plan event's payload (childCount + digest) — the memo projects the dormant plan fields, no producer exists (U2). */
function lastPlanOf(events: readonly SddEvent[]): MemoFields['plan'] {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event !== undefined && event.type === 'plan') return { childCount: event.childCount, digest: event.digest }
  }
  return null
}

/**
 * The memo projection as a pure function of the log (C5 D7 — parity
 * complete): every field sdd-runner persisted derives from the events and
 * the folded context. Terminal rules reconciled against the real persisted
 * `state.json`s: `gate` nulls at terminal status (legacy nulls at finalize),
 * `stage` holds the last ENTERED stage rather than the final position
 * (legacy completed runs say `gate`, not `completed`), and the deadline
 * residues mirror the fold's non-projected context.
 */
export function memoFieldsOf(
  events: readonly SddEvent[],
  context: KernelContext,
  halted: ParkedReason,
  position: string,
): MemoFields {
  const lastEnter = [...events].reverse().find((event) => event.type === 'stage_enter')
  // Failure-caused terminal (C6 D8), derived from the events: an answered
  // abort at an escalation-mode gate. Parity-free — no historical run ever
  // persisted `failed`.
  const failureCaused = events.some(
    (event) =>
      event.type === 'gate' && event.action === 'answered' && event.outcome === 'abort' && event.mode === 'escalation',
  )
  return {
    stage: lastEnter !== undefined && lastEnter.type === 'stage_enter' ? lastEnter.stage : 'intake',
    depth: context.depth,
    round: context.round?.current ?? 0,
    roundCap: context.round?.cap ?? resolveRoundCap({ depth: context.depth }),
    gate:
      halted === 'final' || context.gate === null ? null : { mode: context.gate.mode, version: context.gate.version },
    status: memoStatusOf(halted, position, failureCaused),
    createdAt: events[0]?.ts ?? new Date().toISOString(),
    updatedAt: events[events.length - 1]?.ts ?? new Date().toISOString(),
    autoExtendsUsed: context.autoDecisions.filter((record) => record.decision === 'extend').length,
    gateDeadlineAt: context.gateDeadlineAt,
    gateDeadlineReArmed: context.gateDeadlineReArmed,
    plan: lastPlanOf(events),
    children: Object.keys(context.children).length === 0 ? null : context.children,
  }
}

/**
 * The derived memo (design D6): written after appends as a pure projection of
 * the log — stage from the last entered stage, round and gate from context,
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
    ...memoFieldsOf(events, context, halted, position),
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
  // The calm-stop marker is the default stop seam (C6 D7): the stop verb is
  // its first producer; a drive honors it at the next boundary.
  const runDir = path.join(seed.workDir, 'runs', seed.runId)
  const stop = deps.stop ?? createStopMarkerSeam(runDir)
  const workFor = createPipelineWorkFor(
    {
      spawn: deps.spawn,
      execGit: deps.execGit,
      driver: deps.driver,
      config: deps.config,
      conventions: deps.conventions,
      stdout: deps.stdout,
      stop,
    },
    input,
  )
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

/** The loop's escalation presenter (C6 D4): renders the gate, moves position, runs the ladder. */
function escalationPresenterOf(
  deps: RunDeps,
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
 * The gate continuation loop (design D3): after a gate-pending park, wait in
 * the foreground waiter, settle, and re-drive — repeating while the run keeps
 * presenting gates. Shared by start and resume so a parked resume continues
 * identically.
 */
async function waitSettledGates(
  deps: RunDeps,
  seed: MemoSeed,
  input: { readonly taskText: string; readonly changeName: string; readonly depthOverride?: DepthProfile },
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
 * Owed-presentation recovery (C5 D5): append the presented event the crashed
 * presenter never landed (at the file-scan version) and re-run the ladder —
 * which may itself settle through the seam. Pure recovery: no work re-enters,
 * the run parks gate-pending right after unless the ladder decided.
 */
async function recoverOwedPresentation(
  deps: RunDeps,
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
async function recoverOwedEscalation(
  deps: RunDeps,
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

/**
 * Resume by replay (design D6/D7): a pure function of the event log plus the
 * session ledger — re-fold, append the owed mover when a settle's mover
 * never landed, heal the owed presentation when the tail presenter died in
 * the entry↔presented window, derive the parked reason as data, and either
 * re-enter the interrupted stage through the same drive loop or report the
 * park. No persisted state pointer is consulted for control flow.
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
  let folded = foldRun(logPath)
  const owedPresentation = owedPresentationOf(folded.context, folded.position, runDir)
  if (owedPresentation !== null && owedPresentation.type === 'gate') {
    const boundary = createAppendBoundary(pipelineMachine, logPath, { now: deps.now })
    boundary.append(owedPresentation)
    const changeNameForRecovery = await changeNameOf(deps, runId, runDir)
    await recoverOwedPresentation(deps, runDir, logPath, changeNameForRecovery, {
      version: owedPresentation.version,
    })
    folded = foldRun(logPath)
  }
  const owedEscalation = owedEscalationPresentationOf(folded.context, folded.position, runDir)
  if (owedEscalation !== null) {
    const changeNameForRecovery = await changeNameOf(deps, runId, runDir)
    await recoverOwedEscalation(deps, runDir, logPath, changeNameForRecovery, owedEscalation)
    folded = foldRun(logPath)
  }
  const owed = owedMoversOf(folded.context, folded.position)
  if (owed.length > 0) {
    const boundary = createAppendBoundary(pipelineMachine, logPath, { now: deps.now })
    for (const event of owed) boundary.append(event)
    folded = foldRun(logPath)
  }
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
    if (parked === 'gate-pending' && deps.gateWait !== undefined) {
      // A parked gate resumes into the same foreground continuation a live
      // drive uses: wait for the settle, then continue per outcome.
      const runDirHere = runDir
      writeHolder(runDirHere)
      try {
        const initial: DriveResult = {
          position: folded.position,
          context: folded.context,
          parked: 'gate-pending',
        }
        const result = await waitSettledGates(
          deps,
          seed,
          { taskText, changeName },
          runDirHere,
          logPath,
          workFor,
          initial,
        )
        await writeRunMemo(seed, result.parked, result.position, result.context, logPath)
        deps.stdout?.(parkLine(result.parked))
        return { runId, halted: result.parked, position: result.position, drove: result.parked !== 'gate-pending' }
      } finally {
        removeHolder(runDirHere)
      }
    }
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

export type OperatorStop =
  | { readonly kind: 'calm-requested'; readonly runId: string }
  | { readonly kind: 'aborted'; readonly runId: string }
  | { readonly kind: 'gate-pending'; readonly runId: string }
  | { readonly kind: 'final'; readonly runId: string; readonly position: string }

/**
 * The operator give-up path (C6 D7): a live owner gets the calm-stop marker
 * (the machinery's first producer — honored at the next boundary, parks
 * resumable); a gate-pending run points at steer abort (no new surface); a
 * dead or parked run appends `run_abort`, reaches the aborted final, writes
 * the terminal memo, and releases the session id through TERMINAL_STATUSES.
 */
export async function stopRunOperator(deps: RunDeps, runId: string): Promise<OperatorStop> {
  const runDir = path.join(deps.config.workDir, 'runs', runId)
  const logPath = logPathOf(runDir)
  const folded = foldRun(logPath)
  if (folded.position === 'completed' || folded.position === 'aborted') {
    return { kind: 'final', runId, position: folded.position }
  }
  const gate = folded.context.gate
  if (folded.position === 'gate.awaiting' && gate !== null && !gate.answered) {
    return { kind: 'gate-pending', runId }
  }
  if (runHasLiveOwner(runDir)) {
    requestCalmStop(runDir)
    return { kind: 'calm-requested', runId }
  }
  const boundary = createAppendBoundary(pipelineMachine, logPath, { now: deps.now })
  boundary.append({ altitude: 'L2', type: 'run_abort', reason: 'operator' })
  const after = foldRun(logPath)
  const changeName = await changeNameOf(deps, runId, runDir)
  const seed = seedOf(deps, runId, changeName, folded.createdAt)
  await writeRunMemo(seed, 'final', after.position, after.context, logPath)
  return { kind: 'aborted', runId }
}
