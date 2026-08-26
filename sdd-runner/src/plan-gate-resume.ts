// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { rowsOf, runChildren } from './children.js'
import type { RunChildRun } from './children.js'
import type { EventInput } from './events.js'
import { readEvents } from './events.js'
import type { GateResumeOptions, RunGateResumeResult } from './extend-round.js'
import { planGateCarriesDecision } from './gate-answered.js'
import type { OrchestratorDeps, StageContext } from './gate-digest.js'
import { finalizeGate, logPathFor, nowOf } from './gate-digest.js'
import type { GateChild } from './gate-model.js'
import { presentReplannedGate, settlePlanVeto } from './gate-resume-tail.js'
import { desugarFlags } from './gate-session.js'
import type { GateSessionView } from './gate-session.js'
import { resumeGate, vetoRedirects } from './gate.js'
import { PlanSchema, planDigest, topoSortChildren } from './plan.js'
import type { PlanChild } from './plan.js'
import { saveRunState } from './run-state.js'
import type { RunState } from './run-state.js'
import { createStopMarkerSeam, removeHolder, writeHolder } from './stop-controller.js'

/** D12 plan session view: child rows only — the TUI keeps early/final views until part 3. */
function planSessionView(rows: readonly { readonly id: string; readonly text: string }[]): GateSessionView {
  return {
    gateMode: 'plan',
    items: rows.map((row) => ({ kind: 'child', id: row.id, text: row.text, evidence: '', blastRadius: '' })),
    blockers: [],
    requiredAck: null,
  }
}

/**
 * D12 gate-resume rows: rebuild the expected `C<n>` rows from the current
 * plan sidecar walked in `state.plan.childIds` order — the same numbering
 * the presented digest used.
 */
export async function planGateRows(sidecarDir: string, state: RunState): Promise<readonly GateChild[]> {
  const plan = PlanSchema.parse(JSON.parse(await readFile(path.join(sidecarDir, 'plan.json'), 'utf8')))
  const byId = new Map(plan.children.map((child) => [child.id, child]))
  const ordered: PlanChild[] = []
  for (const id of state.plan?.childIds ?? []) {
    const child = byId.get(id)
    if (child === undefined) throw new Error(`plan sidecar has no child ${id}`)
    ordered.push(child)
  }
  return rowsOf(ordered)
}

/**
 * Interrupted-replan recovery: a crash anywhere between a veto round's
 * planner sidecar overwrite and the re-presented gate's `state.gate` persist
 * leaves the pending gate describing a superseded plan — child ids the
 * sidecar no longer carries, a digest it no longer matches (instructions
 * hashed in), or an event log whose fresh `plan` event was never followed by
 * the presentation the persisted `state.gate` still points at. The sidecar
 * is the single source of the current plan (D3), so the resume finishes the
 * interrupted settle — adopt the sidecar plan, re-materialize, and re-present
 * at the next gate version. Returns null when the pair is still consistent.
 */
async function recoverInterruptedReplan(
  deps: OrchestratorDeps,
  state: RunState,
  emit: (event: EventInput) => void,
  version: number,
): Promise<RunGateResumeResult | null> {
  const pending = state.plan
  if (pending === undefined || pending.childIds.length === 0) return null
  const sidecarDir = path.join(state.runDir, 'sidecars')
  const plan = PlanSchema.parse(JSON.parse(await readFile(path.join(sidecarDir, 'plan.json'), 'utf8')))
  const byId = new Map(plan.children.map((child) => [child.id, child]))
  const walked = pending.childIds.flatMap((id) => {
    const child = byId.get(id)
    return child === undefined ? [] : [child]
  })
  const consistent =
    walked.length === pending.childIds.length &&
    walked.length === plan.children.length &&
    planDigest(walked) === pending.digest &&
    !replanSettledPastGate(state, version)
  if (consistent) return null
  deps.stdout?.(
    'plan gate: the sidecar plan moved past the pending gate (interrupted replan) — adopting the sidecar plan and re-presenting',
  )
  return presentReplannedGate(deps, state, stageCtxOf(deps, state, emit), topoSortChildren(plan), version)
}

/**
 * The event log records a replan the pending gate never caught up with: a
 * fresh `plan` event newer than the last plan-gate presentation (crash after
 * the `state.plan` persist, before `presentGateAt`), or a plan-gate
 * presentation newer than the persisted gate version (crash after the
 * `gate presented` append, before the `state.gate` persist). Both appends
 * precede the persists they describe, so the ordering is durable.
 */
function replanSettledPastGate(state: RunState, version: number): boolean {
  const logPath = logPathFor(state)
  if (!existsSync(logPath)) return false
  let lastPlan = -1
  let lastPresented = -1
  let presentedVersion = version
  readEvents(logPath).forEach((event, index) => {
    if (event.type === 'plan') lastPlan = index
    if (event.type === 'gate' && event.action === 'presented' && event.mode === 'plan') {
      lastPresented = index
      presentedVersion = event.version
    }
  })
  return lastPlan > lastPresented || presentedVersion > version
}

export interface PlanGateResumeDeps {
  /** Nested-run starter: the orchestrator's `runStart` by default. */
  readonly startChildRun: RunChildRun
}

/**
 * D12 plan-gate resume: expected content from `sidecars/plan.json` +
 * `state.plan`; decision flags desugar through the D4 render-then-parse
 * functions onto the gate file; a flagless resume of a still-unanswered file
 * abandons without settling (no TUI session at plan mode in part 2, and an
 * unchecked C-row must not spend a veto replan by default); an answered
 * hand-edit is parsed as-is; approve → `runChildren`; abort →
 * `finalizeGate('abandoned')` before any child exists; extend is unreachable
 * (the parser rejects `→ RUN 1 MORE` at plan mode first); veto rounds land
 * with `settlePlanVeto` (6.3); a sidecar moved past the pending gate by an
 * interrupted replan is recovered through `presentReplannedGate` first.
 */
export async function runPlanGateResume(
  deps: OrchestratorDeps,
  state: RunState,
  options: GateResumeOptions,
  emit: (event: EventInput) => void,
  planDeps: PlanGateResumeDeps,
): Promise<RunGateResumeResult> {
  const version = state.gate?.version ?? 1
  const sidecarDir = path.join(state.runDir, 'sidecars')
  const gateMdPath = path.join(state.runDir, `gate-${version}.md`)
  const recovered = await recoverInterruptedReplan(deps, state, emit, version)
  if (recovered !== null) return recovered
  const rows = await planGateRows(sidecarDir, state)
  const abandoned = await desugarOrAbandon(deps, state, options, rows, gateMdPath, version)
  if (abandoned !== null) return abandoned
  writeHolder(state.runDir)
  deps.mountRunScreen?.({ runDir: state.runDir, logPath: logPathFor(state) })
  try {
    const outcome = await resumeGate(
      {
        emit,
        runDir: state.runDir,
        changeDir: path.join(deps.config.repoRoot, 'openspec', 'changes', state.changeName),
        driftCheck: () => Promise.resolve(),
      },
      { version, assumptions: [], blockers: [], children: rows, gateMode: 'plan' },
    )
    if (outcome.kind === 'aborted') return await finalizeGate(deps, state, 'aborted', version)
    if (outcome.kind === 'approved') return await runApprovedPlan(deps, state, emit, version, planDeps)
    if (outcome.kind === 'extend') throw new Error('plan gate: extend is unreachable (cap-hit only)')
    return await settlePlanVeto(deps, state, stageCtxOf(deps, state, emit), vetoRedirects(outcome), version)
  } finally {
    removeHolder(state.runDir)
    deps.unmountRunScreen?.()
  }
}

/**
 * Desugar the decision flags onto the gate file (D4 render-then-parse), then
 * apply the unanswered-gate guard: a flagless resume of a file carrying no
 * human decision abandons rather than parsing an all-children veto.
 */
async function desugarOrAbandon(
  deps: OrchestratorDeps,
  state: RunState,
  options: GateResumeOptions,
  rows: readonly GateChild[],
  gateMdPath: string,
  version: number,
): Promise<RunGateResumeResult | null> {
  if (
    options.abort === true ||
    options.confirmAll === true ||
    options.extend === true ||
    (options.vetoes?.length ?? 0) > 0
  ) {
    await desugarFlags(options, planSessionView(rows), (md) => writeFile(gateMdPath, md))
  }
  if (!planGateCarriesDecision(await readFile(gateMdPath, 'utf8'))) {
    deps.stdout?.(
      `${path.relative(deps.config.repoRoot, gateMdPath)} has no decision yet — no checked child, no → redirect, no ABORT`,
    )
    deps.stdout?.(
      'plan gate: hand-edit the file (check C-boxes to approve, → <redirect> beneath a vetoed child, or ABORT on its own line), then rerun — an unanswered gate is never parsed as a veto',
    )
    return { runId: state.runId, outcome: 'abandoned', version }
  }
  return null
}

/** Approve settles the plan gate (gate cleared, run continues) and drives the children. */
async function runApprovedPlan(
  deps: OrchestratorDeps,
  state: RunState,
  emit: (event: EventInput) => void,
  version: number,
  planDeps: PlanGateResumeDeps,
): Promise<RunGateResumeResult> {
  state.gate = null
  state.gateDeadlineAt = null
  state.gateDeadlineReArmed = false
  await saveRunState(state, nowOf(deps))
  const stop = createStopMarkerSeam(state.runDir)
  await runChildren(deps, state, stageCtxOf(deps, state, emit), { runChildRun: planDeps.startChildRun, stop })
  return { runId: state.runId, outcome: 'approved', version }
}

function stageCtxOf(deps: OrchestratorDeps, state: RunState, emit: (event: EventInput) => void): StageContext {
  return {
    cwd: deps.config.repoRoot,
    changeDir: path.join(deps.config.repoRoot, 'openspec', 'changes', state.changeName),
    sidecarDir: path.join(state.runDir, 'sidecars'),
    emit,
  }
}
