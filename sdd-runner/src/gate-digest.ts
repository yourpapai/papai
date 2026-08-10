// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { z } from 'zod'

import type { SpawnFn } from '../../review-loop/src/agent-runner.js'
import { agentWritePath } from '../../review-loop/src/agent-runner.js'
import { runStageAgent } from './agent-layer.js'
import type { AgentLayerDeps } from './agent-layer.js'
import type { ExecGitFn, RunnerConfig } from './config.js'
import { createEventBus } from './event-bus.js'
import { appendEvent, readEvents } from './events.js'
import type { AgentUsage, EventInput, SddEvent } from './events.js'
import type { GateAssumption, GateBlocker } from './gate-model.js'
import { presentGate } from './gate.js'
import type { OpenSpecDriver } from './openspec-driver.js'
import { ResolverOutputSchema } from './review-loop.js'
import type { ReviewLoopResult } from './review-loop.js'
import { saveRunState } from './run-state.js'
import type { RunState } from './run-state.js'
import { aggregateUsage } from './usage-aggregate.js'

export interface OrchestratorDeps {
  readonly config: RunnerConfig
  readonly spawn: SpawnFn
  readonly execGit: ExecGitFn
  readonly driver: OpenSpecDriver
  readonly render?: (event: EventInput) => void
  readonly stdout?: (line: string) => void
  readonly conventions?: string
  readonly now?: () => Date
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
  if (deps.render !== undefined) bus.subscribe(deps.render)
  return bus.emit
}

export async function presentGateAt(
  deps: OrchestratorDeps,
  state: RunState,
  ctx: StageContext,
  reviewResult: ReviewLoopResult,
  version: number,
  mode: 'early' | 'final',
): Promise<RunStartResult> {
  const events = readEvents(logPathFor(state))
  const { costUsd, durationMs } = costAndDuration(events, state.createdAt, nowOf(deps))
  const assumptions = await gatherAssumptions(ctx.sidecarDir, reviewResult.rounds)
  const result = await presentGate(
    { emit: ctx.emit, runDir: state.runDir, changeDir: ctx.changeDir, driftCheck: () => Promise.resolve() },
    {
      version,
      mode,
      changeName: state.changeName,
      runId: state.runId,
      assumptions,
      blockers: blockersOf(reviewResult),
      summary: state.changeName,
      costUsd,
      durationMs,
    },
  )
  state.gate = { mode, version }
  state.status = 'running'
  await saveRunState(state, nowOf(deps))
  deps.stdout?.(path.relative(deps.config.repoRoot, result.gateMdPath))
  deps.stdout?.(`gate resume ${state.runId}`)
  return { runId: state.runId, halted: 'gate', gateMdPath: result.gateMdPath, version }
}

export const DriftReportSchema = z.object({ tasks_file: z.string().min(1) })

export async function gatherAssumptions(sidecarDir: string, rounds: number): Promise<GateAssumption[]> {
  const indices = Array.from({ length: rounds }, (_, i) => i + 1)
  const perRound = await Promise.all(
    indices.map(async (round) => {
      try {
        const raw = await readFile(path.join(sidecarDir, `resolutions-${round}.json`), 'utf8')
        return ResolverOutputSchema.parse(JSON.parse(raw)).assumptions
      } catch {
        return []
      }
    }),
  )
  const byId = new Map<string, GateAssumption>()
  for (const assumptions of perRound) {
    for (const assumption of assumptions) {
      byId.set(assumption.id, { id: assumption.id, text: assumption.text, blast_radius: assumption.blast_radius })
    }
  }
  return [...byId.values()]
}

export function blockersOf(result: ReviewLoopResult): GateBlocker[] {
  return result.openBlockers.map((entry) => ({
    id: entry.id,
    gap: entry.id,
    evidence: entry.outcome ?? entry.justification ?? '',
  }))
}

export function costAndDuration(
  events: readonly SddEvent[],
  createdAt: string,
  now: Date,
): { costUsd: number; durationMs: number } {
  const costUsd = aggregateUsage(events).costUsd
  const durationMs = Math.max(0, now.getTime() - new Date(createdAt).getTime())
  return { costUsd, durationMs }
}

export async function applyConfirmAll(gateMdPath: string): Promise<void> {
  const md = await readFile(gateMdPath, 'utf8')
  await writeFile(gateMdPath, md.replace(/- \[ \] (A\d+)/gu, '- [x] $1'))
}

export function buildDriftPrompt(files: readonly string[], tasksFile: string, cwd: string): string {
  const report = agentWritePath(cwd, 'drift.json')
  return [
    'You are the drift-check resolver. The human edited these agent-authored artifacts at the gate:',
    ...files.map((f) => `- ${f}`),
    '',
    `Reconcile tasks.md at ${tasksFile} so it stays consistent with the edited artifacts.`,
    `Write JSON to ${report}: {"tasks_file": "<path relative to repo root>"}`,
  ].join('\n')
}

export type UsageTotals = AgentUsage

export function buildDriftCheck(
  agent: AgentLayerDeps,
  state: RunState,
  changeDir: string,
  sidecarDir: string,
  repoRoot: string,
): (files: readonly string[]) => Promise<void> {
  return async (files) => {
    await runStageAgent(agent, {
      role: 'resolver',
      changeName: state.changeName,
      cwd: repoRoot,
      prompt: buildDriftPrompt(files, path.join(changeDir, 'tasks.md'), repoRoot),
      outputPath: 'drift.json',
      outputSchema: DriftReportSchema,
      label: 'drift',
      logPath: path.join(sidecarDir, 'logs', 'drift.log'),
      sidecarDir,
    })
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
  await saveRunState(state, nowOf(deps))
  return { runId: state.runId, outcome: status === 'completed' ? 'approved' : 'aborted', version }
}
