// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { existsSync } from 'node:fs'
import path from 'node:path'

import { runChildren, runPlanBranch, planChildrenOf } from './children.js'
import type { RunChildRun } from './children.js'
import { autonomyOf } from './config.js'
import type { AutonomyConfig } from './config.js'
import type { DepthProfile, EventInput } from './events.js'
import { readEvents } from './events.js'
import { buildBus, logPathFor, nowOf, presentGateAt } from './gate-digest.js'
import type { OrchestratorDeps, RunStartResult, StageContext } from './gate-digest.js'
import { PLAN_REVIEW_SURROGATE } from './gate-prelude.js'
import { agentDepsOf } from './pipeline-env.js'
import { planGateRows } from './plan-gate-resume.js'
import type { PlanChild } from './plan.js'
import { runTailFromAtomicity } from './post-review-tail.js'
import { nextGateVersion, settleStoppedResult } from './resume-flow.js'
import { readAllRunStates } from './run-index.js'
import { createRunState, loadRunState, resolveRoundCap, saveRunState } from './run-state.js'
import type { RunState } from './run-state.js'
import { slugifySessionId } from './session-id.js'
import { createStopMarkerSeam, removeHolder, writeHolder } from './stop-controller.js'

/** The orchestrator-supplied nested-run starter (D7): `runStart` by default. */
export type StartChildRun = (
  deps: OrchestratorDeps,
  options: {
    readonly child: PlanChild
    readonly taskFile: string
    readonly spendBaselineUsd: number
    readonly onRunDirReady?: (childRunDir: string) => void
  },
) => Promise<{ readonly runId: string }>

/** The `runStart` options a continuation start consumes (D6, structural — no orchestrator import). */
export interface ContinuationStartOptions {
  readonly taskFile?: string
  readonly depthOverride?: DepthProfile
  readonly autonomy?: { readonly deadlineMinutes?: number }
  readonly spendBaselineUsd?: number
  readonly onRunDirReady?: (runDir: string) => void
}

const CONTINUATION_MAX_SUFFIX = 1000

/**
 * D6 continuation session id: the next free `<slug>-<n>` — the parent holds
 * the bare slug while non-terminal, so the child walks past it (and past any
 * existing suffix, terminal or not, mirroring `allocateSessionId`'s
 * first-absent-candidate rule).
 */
async function nextContinuationSessionId(workDir: string, slug: string): Promise<string> {
  if (slug === '') throw new Error('cannot derive a continuation session id from an empty change name')
  const states = await readAllRunStates(workDir)
  const taken = new Set(states.map((state) => state.runId))
  for (let i = 2; i < CONTINUATION_MAX_SUFFIX; i += 1) {
    const candidate = `${slug}-${String(i)}`
    if (!taken.has(candidate)) return candidate
  }
  throw new Error(
    `no free continuation session id derived from '${slug}' (${String(CONTINUATION_MAX_SUFFIX)} suffixes exhausted)`,
  )
}

/** D6 inherited depth: the parent run behind the child task file (`<parentRunDir>/children/<n>-<slug>.md`). */
async function continuationDepthOf(
  deps: OrchestratorDeps,
  options: ContinuationStartOptions,
): Promise<{ readonly profile: DepthProfile; readonly rationale: string }> {
  if (options.depthOverride !== undefined) return { profile: options.depthOverride, rationale: 'override via --depth' }
  if (options.taskFile === undefined) {
    return { profile: 'S', rationale: 'no parent run to inherit a depth from — defaulted to S' }
  }
  const parentRunId = path.basename(path.dirname(path.dirname(options.taskFile)))
  const parent = await loadRunState(deps.config.workDir, parentRunId).catch(() => null)
  if (parent === null) {
    throw new Error(
      `continuation start cannot find the parent run behind ${options.taskFile ?? '(no task file)'} — the change folder cannot be adopted`,
    )
  }
  return parent.depth === null
    ? { profile: 'S', rationale: `parent run ${parentRunId} carries no depth — defaulted to S` }
    : { profile: parent.depth, rationale: `inherited from parent run ${parentRunId}` }
}

/**
 * D6 continuation state: the adopted change's run state — allocated, depth
 * classified, and persisted before the tail's first flight (D8
 * crash-durability: a crash mid-atomicity resumes on the inherited depth
 * instead of stranding as an unclassifiable 'intake' run).
 */
async function continuationStateOf(
  deps: OrchestratorDeps,
  options: ContinuationStartOptions,
  changeName: string,
): Promise<{
  readonly state: RunState
  readonly depth: DepthProfile
  readonly depthRationale: string
}> {
  const { profile: depth, rationale: depthRationale } = await continuationDepthOf(deps, options)
  const state = await createRunState(
    {
      workDir: deps.config.workDir,
      repoRoot: deps.config.repoRoot,
      changeName,
      runId: await nextContinuationSessionId(deps.config.workDir, slugifySessionId(changeName)),
      spendBaselineUsd: options.spendBaselineUsd,
    },
    nowOf(deps),
  )
  state.depth = depth
  state.roundCap = resolveRoundCap({ depth, roundCap: undefined })
  state.stage = depth === 'S' ? 'gate' : 'atomicity'
  await saveRunState(state, nowOf(deps))
  return { state, depth, depthRationale }
}

/**
 * D6 continuation start: the child that carries `changeName` adopts the
 * existing change folder — intake/draft/review are skipped (the artifacts are
 * already drafted and review-settled in the parent; re-running would
 * `newChange`-collide and re-draft reviewed files), the depth is inherited
 * from the parent (derived from the child task file's parent run dir), and
 * the run enters the shared post-convergence tail at atomicity, presenting
 * its final gate over the adopted-review surrogate — the review evidence
 * legitimately lives in the parent's log, so the ledger books the draft and
 * review spend there only; this child's log carries its own tail spend.
 */
export async function runContinuationStart(
  deps: OrchestratorDeps,
  options: ContinuationStartOptions,
  changeName: string,
): Promise<RunStartResult> {
  const { state, depth, depthRationale } = await continuationStateOf(deps, options, changeName)
  options.onRunDirReady?.(state.runDir)
  const emit = buildBus(deps, logPathFor(state))
  // The inherited depth was never classified here — the event keeps every log
  // fold (report, replay, live renderer) seeing the adopted profile.
  emit({ altitude: 'L2', type: 'depth', profile: depth, rationale: depthRationale, source: 'override' })
  writeHolder(state.runDir)
  deps.mountRunScreen?.({ runDir: state.runDir, logPath: logPathFor(state) })
  const stop = createStopMarkerSeam(state.runDir)
  try {
    const agent = agentDepsOf(deps, emit)
    const halted = await runTailFromAtomicity({
      deps: { ...deps, autonomy: autonomyOf(deps.config, options.autonomy?.deadlineMinutes) },
      state,
      ctx: {
        cwd: deps.config.repoRoot,
        changeDir: path.join(deps.config.repoRoot, 'openspec', 'changes', changeName),
        sidecarDir: path.join(state.runDir, 'sidecars'),
        emit,
      },
      agent,
      depth,
      reviewResult: PLAN_REVIEW_SURROGATE,
      version: 1,
    })
    await settleStoppedResult(deps, state, stop, halted)
    return halted
  } finally {
    removeHolder(state.runDir)
    deps.unmountRunScreen?.()
  }
}

export interface PlanResumeResult {
  readonly runId: string
  readonly halted: 'gate-pending' | 'stopped' | 'completed'
  /** The gate-pending child's runId (D2 routing) — threaded so every caller can route into the child's gate flow. */
  readonly childRunId?: string
}

/** A plan parent (D9): `state.plan` present, resumable while running or stopped. */
export function isPlanParentResume(state: RunState): boolean {
  return state.plan !== undefined && (state.status === 'running' || state.status === 'stopped')
}

/**
 * The earlier crash windows: a crash between the planner's sidecar promotion
 * (`sidecars/plan.json`) and `runPlanBranch`'s first `saveRunState` leaves no
 * persisted `state.plan`, so the plain interception above misses it — yet the
 * promoted sidecar carries everything the interrupted settle needs. Two
 * entries reach that window: the intake-oversize plan (D9 — the durable
 * `depth oversize` verdict is the log's proof) and the decompose-split
 * diversion (D5 — a `needs_split` verdict promoted the sidecar past the
 * persisted `stage: 'decompose'`, and the log's depth event never carries
 * `oversize` because intake classified the run a single).
 */
export function isInterruptedPlanBranchResume(state: RunState): boolean {
  if (state.plan !== undefined || (state.status !== 'running' && state.status !== 'stopped')) return false
  if (!existsSync(path.join(state.runDir, 'sidecars', 'plan.json'))) return false
  if (state.stage === 'decompose') return true
  const logPath = logPathFor(state)
  return existsSync(logPath) && readEvents(logPath).some((event) => event.type === 'depth' && event.oversize === true)
}

/**
 * D5 fail-closed resume: children may run only after the event log records a
 * plan-gate answer for the persisted plan. A crash between `runPlanBranch`'s
 * `state.plan` persist and the `state.gate` persist inside `presentGateAt`
 * leaves `{plan, pending children, running, gate: null}` — exactly the
 * plan-parent resume shape — so the durable log, not the gate field, decides.
 * `presentedVersion` carries an appended-but-unpersisted presentation so the
 * re-present overwrites that same gate file instead of forking versions.
 */
function planGateApprovalOf(state: RunState): { answered: boolean; presentedVersion: number | null } {
  const logPath = logPathFor(state)
  if (!existsSync(logPath)) return { answered: false, presentedVersion: null }
  let planAt = -1
  let answered = false
  let presentedVersion: number | null = null
  readEvents(logPath).forEach((event, index) => {
    if (event.type === 'plan' && event.digest === state.plan?.digest) {
      planAt = index
      answered = false
      presentedVersion = null
      return
    }
    if (planAt === -1 || event.type !== 'gate' || event.mode !== 'plan') return
    if (event.action === 'presented') presentedVersion = event.version
    if (event.action === 'answered') answered = true
  })
  return { answered, presentedVersion }
}

/**
 * Parent resume interception (D9): a plan parent never reaches
 * `resumeFromPoint` (which would misroute its children-pending decision into
 * the single-run tail) — it drives `runChildren` instead, with the default
 * nested-run seam: the supplied starter (the orchestrator's `runStart`) over
 * the materialized child task file. A plan whose gate was never answered
 * (crash before the presentation settled) is re-presented instead — the plan
 * gate is human-only (D5), so no resume may convert 'never approved' into
 * 'approved'.
 */
export async function resumePlanParent(
  deps: OrchestratorDeps,
  state: RunState,
  emit: (event: EventInput) => void,
  autonomy: AutonomyConfig,
  startChildRun: StartChildRun,
): Promise<PlanResumeResult> {
  const stop = createStopMarkerSeam(state.runDir)
  writeHolder(state.runDir)
  deps.mountRunScreen?.({ runDir: state.runDir, logPath: logPathFor(state) })
  try {
    const resolved: OrchestratorDeps = { ...deps, autonomy }
    const ctx: StageContext = {
      cwd: resolved.config.repoRoot,
      changeDir: path.join(resolved.config.repoRoot, 'openspec', 'changes', state.changeName),
      sidecarDir: path.join(state.runDir, 'sidecars'),
      emit,
    }
    if (state.plan === undefined) {
      // Finish the interrupted `runPlanBranch` settle from the sidecar (D3):
      // topo-sort, re-materialize, digest, persist `state.plan`/children —
      // then present the plan gate. No gate answer can predate a plan
      // persist, so the presentation starts the gate fresh — at the next
      // free version, which is 1 unless the split diversion crashed past an
      // earlier gate file (an early-gate approval entered the tail).
      await runPlanBranch(resolved, state, ctx, await planChildrenOf(ctx), { version: nextGateVersion(state) })
      return { runId: state.runId, halted: 'gate-pending' }
    }
    const approval = planGateApprovalOf(state)
    if (!approval.answered) {
      await presentGateAt(resolved, state, ctx, PLAN_REVIEW_SURROGATE, approval.presentedVersion ?? 1, 'plan', {
        children: await planGateRows(ctx.sidecarDir, state),
      })
      return { runId: state.runId, halted: 'gate-pending' }
    }
    const runChildRun: RunChildRun = (child, taskFile, spendBaselineUsd, onRunDirReady) =>
      startChildRun(resolved, { child, taskFile, spendBaselineUsd, onRunDirReady })
    const result = await runChildren(resolved, state, ctx, { runChildRun, stop })
    return {
      runId: state.runId,
      halted: result.halted,
      ...(result.halted === 'gate-pending' ? { childRunId: result.childRunId } : {}),
    }
  } finally {
    removeHolder(state.runDir)
    deps.unmountRunScreen?.()
  }
}
