// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { writeFile } from 'node:fs/promises'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { rowsOf, runChildren } from './children.js'
import type { RunChildRun } from './children.js'
import { looksAnswered } from './deadline-waiter.js'
import type { EventInput } from './events.js'
import type { GateResumeOptions, RunGateResumeResult } from './extend-round.js'
import type { OrchestratorDeps, StageContext } from './gate-digest.js'
import { finalizeGate, logPathFor, nowOf } from './gate-digest.js'
import type { GateChild } from './gate-model.js'
import { settlePlanVeto } from './gate-resume-tail.js'
import { desugarFlags } from './gate-session.js'
import type { GateSessionView } from './gate-session.js'
import { resumeGate, vetoRedirects } from './gate.js'
import { PlanSchema } from './plan.js'
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

const ABORT_LINE_RE = /^\s*ABORT\s*$/mu
const DIRECTIVE_LINE_RE = /^\s*→/mu

/**
 * Whether the gate file carries a human decision at all: a checked box or a
 * response section (`looksAnswered`), an `ABORT` line, or a `→` directive.
 * A freshly presented digest has none of these — every C-box unchecked — and
 * parsing it as-is would veto every child and spend a replan, so a flagless
 * resume of such a file must abandon instead (mirroring the deadline
 * waiter's answered check and the early/final TUI's write-nothing abandon).
 */
function planGateCarriesDecision(md: string): boolean {
  return looksAnswered(md) || ABORT_LINE_RE.test(md) || DIRECTIVE_LINE_RE.test(md)
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
 * with `settlePlanVeto` (6.3).
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
  const rows = await planGateRows(sidecarDir, state)
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
