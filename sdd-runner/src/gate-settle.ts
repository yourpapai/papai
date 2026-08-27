// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { PolicyDecision } from './auto-policy.js'
import { renderGateAnswers } from './gate-answers.js'
import type { GateAnswers } from './gate-answers.js'
import type { OrchestratorDeps, RunStartResult, StageContext } from './gate-digest.js'
import { finalizeGate, nowOf } from './gate-digest.js'
import type { GateAssumption } from './gate-model.js'
import { parseGateResponse } from './gate-model.js'
import type { PolicyGateInput } from './gate-prelude.js'
import { presentGate, verifyGateIntegrity } from './gate.js'
import { saveRunState } from './run-state.js'
import type { RunState } from './run-state.js'
import { clearStagedSteer } from './steer.js'

/** Plan-mode guard (D5): the auto paths only exist for early/final gates. */
function assertNotPlanGate(state: RunState, operation: string): void {
  if (state.gate?.mode === 'plan') {
    throw new Error(`${operation} refuses plan mode: the plan gate is decided by a human only`)
  }
}

/**
 * D3 step 4 auto-settle for a permitted R1 approve on a final gate. Write
 * order: gate file (answered, with `decided-by: policy R1`) + hashes sidecar
 * (written by the presentation) → `gate presented` → integrity verification
 * (same helper the human path uses) → settle tail (`finalizeGate completed`)
 * → `gate answered` → `auto_decision` → state save. The `gate answered`
 * event is the settle commit record (D5).
 */
export async function autoSettleFinalGate(
  deps: OrchestratorDeps,
  state: RunState,
  ctx: StageContext,
  decision: PolicyDecision,
  input: PolicyGateInput,
): Promise<RunStartResult> {
  assertNotPlanGate(state, 'autoSettleFinalGate')
  const gateMdPath = path.join(state.runDir, `gate-${input.version}.md`)
  const md = renderAutoApproveAnswers(decision, input.assumptions)
  await presentAutoDecidedGate(deps, state, ctx, input, md)
  await verifyGateIntegrity(
    { emit: ctx.emit, runDir: state.runDir, changeDir: ctx.changeDir, driftCheck: () => Promise.resolve() },
    input.version,
  )
  ctx.emit({ altitude: 'L2', type: 'gate', action: 'answered', mode: 'final', version: input.version })
  ctx.emit({
    altitude: 'L2',
    type: 'auto_decision',
    rule: decision.rule,
    decision: 'approve',
    evidenceDigest: decision.evidenceDigest,
    gateVersion: input.version,
  })
  await finalizeGate(deps, state, 'completed', input.version)
  clearStagedSteer(state.runDir)
  deps.stdout?.(path.relative(deps.config.repoRoot, gateMdPath))
  deps.stdout?.(`auto-decided by policy ${decision.rule} — run ${state.runId} completed`)
  return { runId: state.runId, halted: 'gate', gateMdPath, version: input.version }
}

export function renderAutoApproveAnswers(decision: PolicyDecision, assumptions: readonly GateAssumption[]): string {
  const answers: GateAnswers = {
    items: assumptions.map((assumption) => ({
      kind: 'assumption' as const,
      id: assumption.id,
      text: assumption.text,
      accepted: true,
      decidedBy: `policy ${decision.rule}`,
    })),
    blockerAnswers: [],
    acks: [],
    decision: 'approve',
    decidedBy: `policy ${decision.rule}`,
  }
  const md = renderGateAnswers(answers)
  const parsed = parseGateResponse(md, {
    assumptions,
    blockers: [],
    gateMode: 'final',
  })
  if (!parsed.approved) {
    throw new Error('policy self-check failed: rendered auto-answers did not parse back as approved')
  }
  return md
}

async function presentAutoDecidedGate(
  deps: OrchestratorDeps,
  state: RunState,
  ctx: StageContext,
  input: PolicyGateInput,
  answeredMd: string,
): Promise<void> {
  void deps
  const presented = await presentGate(
    { emit: ctx.emit, runDir: state.runDir, changeDir: ctx.changeDir, driftCheck: () => Promise.resolve() },
    {
      version: input.version,
      mode: 'final',
      changeName: state.changeName,
      runId: state.runId,
      assumptions: input.assumptions,
      blockers: [],
      openMaterial: [],
      openNitpicks: [],
      trajectory: input.trajectory,
      capHitFired: false,
      summary: state.changeName,
      costUsd: input.costUsd,
      costKnown: input.costKnown,
      durationMs: 0,
      changeDigest: { what: null, why: null, touches: null, hasTasks: false },
    },
  )
  await writeFile(presented.gateMdPath, answeredMd)
}

/**
 * D3 R2 routing: a policy-decided extend increments and persists
 * `autoExtendsUsed` BEFORE the extended round starts spending (a crash
 * mid-extended-round still consumes the bound), emits the `auto_decision`
 * extend event, then routes into the existing `runExtendRound` unmodified —
 * one decision still binds exactly one round of spend. A steered extend
 * (human `--extend` flag) never passes through here and never consumes the
 * auto-extend allowance.
 */
export async function autoExtendRound(
  deps: OrchestratorDeps,
  state: RunState,
  ctx: StageContext,
  decision: PolicyDecision,
  version: number,
): Promise<RunStartResult> {
  assertNotPlanGate(state, 'autoExtendRound')
  state.autoExtendsUsed += 1
  await saveRunState(state, nowOf(deps))
  ctx.emit({
    altitude: 'L2',
    type: 'auto_decision',
    rule: decision.rule,
    decision: 'extend',
    evidenceDigest: decision.evidenceDigest,
    gateVersion: version,
  })
  const { runExtendRound } = await import('./extend-round.js')
  const agent = { spawn: deps.spawn, config: deps.config, execGit: deps.execGit, emit: ctx.emit }
  const result = await runExtendRound(deps, state, ctx.emit, agent, version)
  deps.stdout?.(`auto-extended by policy ${decision.rule} — run ${state.runId} at gate v${result.version}`)
  return {
    runId: state.runId,
    halted: 'gate',
    gateMdPath: result.gateMdPath ?? path.join(state.runDir, `gate-${result.version}.md`),
    version: result.version,
  }
}
