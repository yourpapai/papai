// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readFile } from 'node:fs/promises'
import path from 'node:path'

import type { SpawnFn } from '../../review-loop/src/agent-runner.js'
import type { AutonomyConfig, ExecGitFn, RunnerConfig } from './config.js'
import { deadlineStampFor } from './deadline-waiter.js'
import { createEventBus } from './event-bus.js'
import { appendEvent } from './events.js'
import type { EventInput } from './events.js'
import { readChangeDigest } from './gate-digest-extract.js'
import { gatherAssumptions } from './gate-digest-extract.js'
import type { ChangeDigest } from './gate-digest-extract.js'
import type { GateAssumption, GateBlocker, GateChild, GateFinding } from './gate-model.js'
import {
  PLAN_REVIEW_SURROGATE,
  planForGate,
  runPlanPolicy,
  runPolicyLadder,
  writePresentedRecord,
} from './gate-prelude.js'
import type { PolicyGateInput } from './gate-prelude.js'
import { autoExtendRound, autoSettleFinalGate } from './gate-settle.js'
import { gatherGateSignals } from './gate-signals.js'
import type { PresentGateInput } from './gate.js'
import { presentGate } from './gate.js'
import type { OpenSpecDriver } from './openspec-driver.js'
import { replayEvents } from './replay.js'
import { ResolverOutputSchema } from './review-loop.js'
import type { ReviewLoopResult } from './review-loop.js'
import { saveRunState } from './run-state.js'
import type { RunState } from './run-state.js'
import type { ResolveCostFn } from './usage-aggregate.js'

export interface OrchestratorDeps {
  readonly config: RunnerConfig
  readonly spawn: SpawnFn
  readonly execGit: ExecGitFn
  readonly driver: OpenSpecDriver
  readonly render?: (event: EventInput) => void
  /** Live-view sink (tui mode); when present it replaces `render` on the bus. */
  readonly liveEvents?: (event: EventInput) => void
  /** Mount the Ink running screen for a run about to drive stages (tui mode). */
  readonly mountRunScreen?: (ctx: { readonly runDir: string; readonly logPath: string }) => void
  /** Unmount the running screen (run halted, process ending). */
  readonly unmountRunScreen?: () => void
  readonly stdout?: (line: string) => void
  readonly conventions?: string
  readonly now?: () => Date
  readonly resolveCost?: ResolveCostFn
  readonly interactive?: () => boolean
  /** Scripted keys driving the TUI gate session in tests (live stdin otherwise). */
  readonly gateKeyScript?: string
  /**
   * Per-process resolved autonomy config (CLI > config > default, normalized
   * cost ceiling). The policy module reads this; it never sees the CLI.
   */
  readonly autonomy?: AutonomyConfig
}

export interface RunStartResult {
  readonly runId: string
  readonly halted: 'gate'
  readonly gateMdPath: string
  readonly version: number
}

export interface StageContext {
  readonly cwd: string
  readonly changeDir: string
  readonly sidecarDir: string
  readonly emit: (event: EventInput) => void
}

export function logPathFor(state: RunState): string {
  return path.join(state.runDir, 'events.ndjson')
}

export function nowOf(deps: OrchestratorDeps): Date {
  return deps.now?.() ?? new Date()
}

export function buildBus(deps: OrchestratorDeps, logPath: string): (event: EventInput) => void {
  const bus = createEventBus({ onError: (error) => deps.stdout?.(`[event-bus] ${error.message}`) })
  bus.subscribe((event) => {
    appendEvent(logPath, event)
  })
  if (deps.liveEvents !== undefined) bus.subscribe(deps.liveEvents)
  else if (deps.render !== undefined) bus.subscribe(deps.render)
  return bus.emit
}

export async function presentGateAt(
  deps: OrchestratorDeps,
  state: RunState,
  ctx: StageContext,
  reviewResult: ReviewLoopResult,
  version: number,
  mode: 'early' | 'final' | 'plan',
  options: { readonly skipPolicy?: boolean; readonly children?: readonly GateChild[] } = {},
): Promise<RunStartResult> {
  const effectiveReview = mode === 'plan' ? PLAN_REVIEW_SURROGATE : reviewResult
  const signals = await gatherGateSignals(deps, state, ctx, effectiveReview)
  const policyInput = { mode, version, ...signals }
  const evaluation =
    options.skipPolicy === true
      ? null
      : mode === 'plan'
        ? runPlanPolicy(deps, state, signals, (options.children ?? []).length)
        : runPolicyLadder(deps, state, ctx, effectiveReview, policyInput)
  const routed = await routeAutoDecision(deps, state, ctx, planForGate(state, evaluation), mode, version, policyInput)
  if (routed !== null) return routed
  const result = await presentGate(
    { emit: ctx.emit, runDir: state.runDir, changeDir: ctx.changeDir, driftCheck: () => Promise.resolve() },
    gateDigestInput(state, effectiveReview, await digestParts(version, mode, signals, effectiveReview, options, ctx)),
  )
  state.gate = { mode, version }
  state.status = 'running'
  const deadline = deadlineStampFor(deps)
  state.gateDeadlineAt = deadline.gateDeadlineAt
  state.gateDeadlineReArmed = false
  await saveRunState(state, nowOf(deps))
  if (evaluation !== null) await writePresentedRecord(deps, state, ctx, evaluation, policyInput)
  announceDeadline(deps, deadline.notify)
  deps.stdout?.(path.relative(deps.config.repoRoot, result.gateMdPath))
  deps.stdout?.(`Next: sdd ${state.runId}`)
  return { runId: state.runId, halted: 'gate', gateMdPath: result.gateMdPath, version }
}

/** Settle/extend auto-routing: only ever reachable at final/early modes. */
function routeAutoDecision(
  deps: OrchestratorDeps,
  state: RunState,
  ctx: StageContext,
  plan: ReturnType<typeof planForGate>,
  mode: 'early' | 'final' | 'plan',
  version: number,
  policyInput: PolicyGateInput,
): Promise<RunStartResult | null> {
  if (plan === null) return Promise.resolve(null)
  if (plan.action === 'settle' && mode === 'final') {
    return autoSettleFinalGate(deps, state, ctx, plan.decision, policyInput)
  }
  if (plan.action === 'extend' && mode === 'early') return autoExtendRound(deps, state, ctx, plan.decision, version)
  return Promise.resolve(null)
}

async function digestParts(
  version: number,
  mode: 'early' | 'final' | 'plan',
  signals: Awaited<ReturnType<typeof gatherGateSignals>>,
  reviewResult: ReviewLoopResult,
  options: { readonly children?: readonly GateChild[] },
  ctx: StageContext,
): Promise<GateDigestParts> {
  const findings = findingsOf(reviewResult)
  return {
    version,
    mode,
    assumptions: signals.assumptions,
    blockers: findings.blockers,
    material: findings.material,
    nitpicks: findings.nitpicks,
    trajectory: signals.trajectory,
    costUsd: signals.costUsd,
    costKnown: signals.costKnown,
    durationMs: signals.durationMs,
    changeDigest: await readChangeDigest(ctx.changeDir),
    children: options.children,
  }
}

function announceDeadline(deps: OrchestratorDeps, notify: string | null): void {
  if (notify !== null) deps.stdout?.(notify)
}

interface GateDigestParts {
  readonly version: number
  readonly mode: 'early' | 'final' | 'plan'
  readonly assumptions: readonly GateAssumption[]
  readonly blockers: readonly GateBlocker[]
  readonly material: readonly GateFinding[]
  readonly nitpicks: readonly GateFinding[]
  readonly trajectory: ReturnType<typeof replayEvents>['perRound']
  readonly costUsd: number
  readonly costKnown: boolean
  readonly durationMs: number
  readonly changeDigest: ChangeDigest
  readonly children?: readonly GateChild[]
}

function gateDigestInput(state: RunState, reviewResult: ReviewLoopResult, parts: GateDigestParts): PresentGateInput {
  return {
    version: parts.version,
    mode: parts.mode,
    changeName: state.changeName,
    runId: state.runId,
    assumptions: parts.assumptions,
    blockers: parts.blockers,
    openMaterial: parts.material,
    openNitpicks: parts.nitpicks,
    trajectory: parts.trajectory,
    capHitFired: reviewResult.outcome === 'cap-hit',
    summary: state.changeName,
    costUsd: parts.costUsd,
    costKnown: parts.costKnown,
    durationMs: parts.durationMs,
    changeDigest: parts.changeDigest,
    ...(parts.children === undefined ? {} : { children: parts.children }),
  }
}

export function blockersOf(result: ReviewLoopResult): GateBlocker[] {
  return findingsOf(result).blockers
}

export function findingsOf(result: ReviewLoopResult): {
  blockers: GateBlocker[]
  material: GateFinding[]
  nitpicks: GateFinding[]
} {
  const blockers = result.openBlockers.map((entry) => ({
    id: entry.id,
    gap: entry.id,
    evidence: entry.outcome ?? entry.justification ?? '',
  }))
  const material = result.openMaterial.map((entry) => ({
    id: entry.id,
    gap: entry.id,
    evidence: `${entry.resolution} — ${entry.outcome ?? entry.justification ?? ''}`,
  }))
  const nitpicks = result.openNitpicks.map((entry) => ({
    id: entry.id,
    gap: entry.id,
    evidence: `${entry.resolution} — ${entry.outcome ?? entry.justification ?? ''}`,
  }))
  return { blockers, material, nitpicks }
}

export async function readReviewResultFromSidecars(
  sidecarDir: string,
  round: number,
  outcome: 'converged' | 'cap-hit',
): Promise<ReviewLoopResult> {
  try {
    const raw = await readFile(path.join(sidecarDir, `resolutions-${round}.json`), 'utf8')
    const parsed = ResolverOutputSchema.parse(JSON.parse(raw))
    return {
      outcome,
      rounds: round,
      openBlockers: parsed.resolutions.filter((r) => r.class === 'BLOCKER'),
      openMaterial: parsed.resolutions.filter((r) => r.class === 'MATERIAL'),
      openNitpicks: parsed.resolutions.filter((r) => r.class === 'NITPICK'),
    }
  } catch {
    return { outcome, rounds: round, openBlockers: [], openMaterial: [], openNitpicks: [] }
  }
}

export async function finalizeGate(
  deps: OrchestratorDeps,
  state: RunState,
  status: 'completed' | 'aborted',
  version: number,
): Promise<{ runId: string; outcome: 'approved' | 'aborted'; version: number }> {
  state.status = status
  state.gate = null
  state.gateDeadlineAt = null
  state.gateDeadlineReArmed = false
  await saveRunState(state, nowOf(deps))
  return { runId: state.runId, outcome: status === 'completed' ? 'approved' : 'aborted', version }
}

export async function prepareResumeInput(
  sidecarDir: string,
  round: number,
  gateMode: 'early' | 'final',
): Promise<{
  assumptions: readonly { id: string; text: string; blast_radius: string }[]
  reviewResult: ReviewLoopResult
  requiredAck: string | undefined
}> {
  const assumptions = await gatherAssumptions(sidecarDir, round)
  const capHitFired = gateMode === 'early'
  const reviewResult = await readReviewResultFromSidecars(sidecarDir, round, capHitFired ? 'cap-hit' : 'converged')
  const findings = findingsOf(reviewResult)
  const requiredAck = capHitFired && findings.blockers.length === 0 ? 'T1' : undefined
  return { assumptions, reviewResult, requiredAck }
}
