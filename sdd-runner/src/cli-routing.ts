// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { stat } from 'node:fs/promises'
import path from 'node:path'

import { listPendingGates, readAllRunStates, resolveRunId } from './run-index.js'

/**
 * The single routing verb's target resolution (cli spec): an existing
 * task-file path starts a run; an exact id or unambiguous prefix routes by
 * the run's state (gate-pending → decide, interrupted/stopped → resume,
 * completed → report); with no target, the sole gate-pending run routes,
 * then a single interrupted run, then a single completed run. Any ambiguity
 * lists every candidate with the concrete command that selects it and exits
 * without side effects.
 */

export type RouteAction =
  | { readonly kind: 'start'; readonly taskFile: string }
  | { readonly kind: 'create' }
  | { readonly kind: 'select'; readonly candidates: readonly { runId: string; hint: string }[] }
  | { readonly kind: 'gate'; readonly runId: string }
  | { readonly kind: 'resume'; readonly runId: string }
  | { readonly kind: 'report'; readonly runId: string }
  | { readonly kind: 'stop'; readonly runId: string }

const LEGACY_SUBCOMMANDS = new Set(['start', 'resume', 'gate', 'continue', 'report', 'audit', 'watch'])

export interface ResolveTargetInput {
  readonly workDir: string
  readonly target: string | undefined
  readonly verb?: 'route' | 'stop'
  /** Interactive terminal owns stdin+stdout: ambiguity selects, zero runs create. */
  readonly tty?: boolean
}

function candidateList(candidates: readonly { runId: string; hint: string }[]): string {
  return candidates.map((c) => `  sdd ${c.runId}  (${c.hint})`).join('\n')
}

function isInterrupted(status: string): boolean {
  return status === 'stopped' || (status === 'running' && false)
}

export async function resolveTarget(input: ResolveTargetInput): Promise<RouteAction> {
  const { workDir, target } = input
  if (input.verb === 'stop') {
    const states = await readAllRunStates(workDir)
    if (target !== undefined) return { kind: 'stop', runId: await resolveRunId(workDir, target) }
    const active = states.filter((s) => s.status === 'running' || s.status === 'stopped')
    if (active.length === 1) return { kind: 'stop', runId: active[0]?.runId ?? '' }
    if (active.length > 1) {
      throw new Error(
        `several runs are active — pick one:\n${candidateList(active.map((s) => ({ runId: s.runId, hint: s.status })))}`,
      )
    }
    throw new Error('no active runs to stop')
  }
  if (target !== undefined && LEGACY_SUBCOMMANDS.has(target)) {
    throw new Error(
      `the '${target}' subcommand was removed: use 'sdd <task-file>' to start, 'sdd <run-id>' to route by state, 'sdd stop [<id>]' to calm-stop`,
    )
  }
  if (target !== undefined) {
    const isFile = await stat(target).then(
      (info) => info.isFile(),
      () => false,
    )
    if (isFile) return { kind: 'start', taskFile: target }
    const runId = await resolveRunId(workDir, target)
    return routeByState(workDir, runId)
  }
  return routeBySoleCandidate(workDir, input.tty === true)
}

async function routeByState(workDir: string, runId: string): Promise<RouteAction> {
  const states = await readAllRunStates(workDir)
  const found = states.find((s) => s.runId === runId)
  if (found === undefined) return { kind: 'report', runId }
  // Gate-pending routes to the gate flow regardless of status: a calm-stopped
  // run settles to {gate, stopped} and its gate must stay decidable — matching
  // listPendingGates and routeOfRow, which also ignore status here.
  if (found.gate !== null) return { kind: 'gate', runId }
  if (isInterrupted(found.status) || found.status === 'running') return { kind: 'resume', runId }
  if (found.status === 'completed') return { kind: 'report', runId }
  return { kind: 'report', runId }
}

async function routeBySoleCandidate(workDir: string, tty: boolean): Promise<RouteAction> {
  const states = await readAllRunStates(workDir)
  if (states.length === 0) {
    if (tty) return { kind: 'create' }
    throw new Error('no target given and no runs exist — pass a task file: sdd <task-file>')
  }
  const pending = await listPendingGates(workDir)
  const pendingIds = new Set(pending.map((p) => p.runId))
  const interrupted = states.filter((s) => isInterrupted(s.status) || s.status === 'running')
  const interruptedIds = new Set(interrupted.map((s) => s.runId))
  const completed = states.filter((s) => s.status === 'completed')
  const completedIds = new Set(completed.map((s) => s.runId))
  if (!tty) {
    if (pending.length === 1) return { kind: 'gate', runId: pending[0]?.runId ?? '' }
    if (pending.length > 1) {
      const candidates = pending.map((p) => ({ runId: p.runId, hint: `gate ${p.gateMode} v${p.gateVersion}` }))
      throw new Error(`several gate-pending runs — pick one:\n${candidateList(candidates)}`)
    }
    if (interrupted.length === 1) return { kind: 'resume', runId: interrupted[0]?.runId ?? '' }
    if (interrupted.length > 1) {
      const candidates = interrupted.map((s) => ({ runId: s.runId, hint: s.status }))
      throw new Error(`several interrupted runs — pick one:\n${candidateList(candidates)}`)
    }
    if (completed.length === 1) return { kind: 'report', runId: completed[0]?.runId ?? '' }
    if (completed.length > 1) {
      const candidates = completed.map((s) => ({ runId: s.runId, hint: 'completed' }))
      throw new Error(`several completed runs — pick one:\n${candidateList(candidates)}`)
    }
    throw new Error('no target given and no routable runs exist — pass a task file: sdd <task-file>')
  }
  const routableCount = states.filter(
    (s) => pendingIds.has(s.runId) || interruptedIds.has(s.runId) || completedIds.has(s.runId),
  ).length
  if (routableCount === 1) {
    // A sole gate or interrupted run is the obvious next step — route to it.
    // A sole completed run is not: its report is passive output, so a
    // terminal opens the session screen (report stays one Enter away, and
    // creation stays reachable instead of being stranded behind a dump).
    const solePending = pending.length === 1 ? pending[0]?.runId : undefined
    if (solePending !== undefined) return { kind: 'gate', runId: solePending }
    const soleInterrupted = interrupted.length === 1 ? interrupted[0]?.runId : undefined
    if (soleInterrupted !== undefined) return { kind: 'resume', runId: soleInterrupted }
  }
  return { kind: 'select', candidates: states.map((s) => ({ runId: s.runId, hint: s.status })) }
}

export { readAllRunStates }

// re-export path join helper for candidate lines
export function commandFor(runId: string): string {
  return `sdd ${runId}`
}

export function runDirPath(workDir: string): string {
  return path.join(workDir, 'runs')
}
