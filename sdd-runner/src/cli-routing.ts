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
  | { readonly kind: 'gate'; readonly runId: string }
  | { readonly kind: 'resume'; readonly runId: string }
  | { readonly kind: 'report'; readonly runId: string }
  | { readonly kind: 'stop'; readonly runId: string }

const LEGACY_SUBCOMMANDS = new Set(['start', 'resume', 'gate', 'continue', 'report', 'audit', 'watch'])

export interface ResolveTargetInput {
  readonly workDir: string
  readonly target: string | undefined
  readonly verb?: 'route' | 'stop'
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
  return routeBySoleCandidate(workDir)
}

async function routeByState(workDir: string, runId: string): Promise<RouteAction> {
  const states = await readAllRunStates(workDir)
  const found = states.find((s) => s.runId === runId)
  if (found === undefined) return { kind: 'report', runId }
  if (found.gate !== null && found.status === 'running') return { kind: 'gate', runId }
  if (isInterrupted(found.status) || found.status === 'running') return { kind: 'resume', runId }
  if (found.status === 'completed') return { kind: 'report', runId }
  return { kind: 'report', runId }
}

async function routeBySoleCandidate(workDir: string): Promise<RouteAction> {
  const states = await readAllRunStates(workDir)
  if (states.length === 0) {
    throw new Error('no target given and no runs exist — pass a task file: sdd <task-file>')
  }
  const pending = await listPendingGates(workDir)
  if (pending.length === 1) return { kind: 'gate', runId: pending[0]?.runId ?? '' }
  if (pending.length > 1) {
    throw new Error(
      `several gate-pending runs — pick one:\n${candidateList(pending.map((p) => ({ runId: p.runId, hint: `gate ${p.gateMode} v${p.gateVersion}` })))}`,
    )
  }
  const interrupted = states.filter((s) => isInterrupted(s.status) || s.status === 'running')
  if (interrupted.length === 1) return { kind: 'resume', runId: interrupted[0]?.runId ?? '' }
  if (interrupted.length > 1) {
    throw new Error(
      `several interrupted runs — pick one:\n${candidateList(interrupted.map((s) => ({ runId: s.runId, hint: s.status })))}`,
    )
  }
  const completed = states.filter((s) => s.status === 'completed')
  if (completed.length === 1) return { kind: 'report', runId: completed[0]?.runId ?? '' }
  if (completed.length > 1) {
    throw new Error(
      `several completed runs — pick one:\n${candidateList(completed.map((s) => ({ runId: s.runId, hint: 'completed' })))}`,
    )
  }
  throw new Error('no target given and no routable runs exist — pass a task file: sdd <task-file>')
}

export { readAllRunStates }

// re-export path join helper for candidate lines
export function commandFor(runId: string): string {
  return `sdd ${runId}`
}

export function runDirPath(workDir: string): string {
  return path.join(workDir, 'runs')
}
