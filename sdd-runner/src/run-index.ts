// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

import { lastSpawnedHandleOf } from './child-spawn.js'
import { readLiteRecord } from './run-lite.js'
import type { PersistedLite } from './run-lite.js'
import { loadRunState, PersistedRunStateSchema } from './run-state.js'
import type { RunState } from './run-state.js'

export interface PendingGateEntry {
  readonly runId: string
  readonly changeName: string
  readonly gateMode: 'early' | 'final' | 'plan'
  readonly gateVersion: number
  readonly updatedAt: string
}

/**
 * Scan each run's `state.json` under `runs/` and keep only gate-pending runs
 * (a non-null `gate` field), most recently updated first. Unreadable or
 * corrupt entries are skipped — a listing must not fail because one run dir
 * is mid-write.
 */
export async function listPendingGates(workDir: string): Promise<PendingGateEntry[]> {
  let entries: string[]
  try {
    entries = await readdir(path.join(workDir, 'runs'))
  } catch {
    return []
  }
  const perRun = await Promise.all(
    entries.map(async (runId): Promise<PendingGateEntry | null> => {
      try {
        const raw = await readFile(path.join(workDir, 'runs', runId, 'state.json'), 'utf8')
        const persisted = PersistedRunStateSchema.parse(JSON.parse(raw))
        if (persisted.gate === null) return null
        return {
          runId,
          changeName: persisted.changeName,
          gateMode: persisted.gate.mode,
          gateVersion: persisted.gate.version,
          updatedAt: persisted.updatedAt,
        }
      } catch {
        return null
      }
    }),
  )
  return perRun
    .filter((entry): entry is PendingGateEntry => entry !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

/** Every persisted run state under the work dir, newest-first. */
export async function readAllRunStates(workDir: string): Promise<PersistedLite[]> {
  let entries: string[]
  try {
    entries = await readdir(path.join(workDir, 'runs'))
  } catch {
    return []
  }
  const perRun = await Promise.all(
    entries.map(async (runId): Promise<PersistedLite | null> => {
      try {
        const raw = await readFile(path.join(workDir, 'runs', runId, 'state.json'), 'utf8')
        const record = readLiteRecord(raw)
        if (record === null) return null
        return { runId, ...record }
      } catch {
        return null
      }
    }),
  )
  return perRun
    .filter((entry): entry is PersistedLite => entry !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

/**
 * Resolve a run-id argument: exact directory match wins; otherwise a unique
 * prefix among known runs; unknown ids and ambiguous prefixes fail loudly
 * with the candidate ids listed (prefixes are an interactive convenience —
 * scripts should use full ids).
 */
export async function resolveRunId(workDir: string, arg: string): Promise<string> {
  let entries: string[]
  try {
    entries = await readdir(path.join(workDir, 'runs'))
  } catch {
    throw new Error(`no runs found under ${path.join(workDir, 'runs')} (unknown run id: ${arg})`)
  }
  if (entries.includes(arg)) return arg
  const prefixed = entries.filter((runId) => runId.startsWith(arg))
  if (prefixed.length === 1) return prefixed[0] ?? arg
  if (prefixed.length > 1) {
    throw new Error(`ambiguous run id: ${arg} — candidates:\n${prefixed.map((id) => `  ${id}`).join('\n')}`)
  }
  throw new Error(`unknown run id: ${arg}`)
}

/**
 * D1 tree discovery: the deepest gate-pending descendant runId of a run —
 * for each `running` child record its concrete runId is the parent log's
 * last `child_spawned` line (`lastSpawnedHandleOf`), the child's own
 * `state.json` is re-read, and grandchildren recurse before the child's own
 * gate, so the deepest pending gate wins. An unloadable child state counts
 * as no pending gate (the parent falls back to plain resume); a visited-set
 * guards malformed cyclic state. A non-parent or no-descendant state yields
 * null.
 */
export function descendantGateOf(workDir: string, state: RunState): Promise<string | null> {
  return scanDescendantGate(workDir, state, new Set())
}

function scanDescendantGate(workDir: string, state: RunState, visited: Set<string>): Promise<string | null> {
  if (visited.has(state.runId)) return Promise.resolve(null)
  visited.add(state.runId)
  const running = Object.entries(state.children ?? {}).filter(([, record]) => record.status === 'running')
  const scanAt = async (index: number): Promise<string | null> => {
    const [childId] = running[index] ?? []
    if (childId === undefined) return null
    const handle = lastSpawnedHandleOf(state, childId)
    if (handle === null || visited.has(handle.runId)) return scanAt(index + 1)
    const childState = await loadRunState(workDir, handle.runId).catch(() => null)
    if (childState === null) return scanAt(index + 1)
    const deeper = await scanDescendantGate(workDir, childState, visited)
    if (deeper !== null) return deeper
    if (childState.gate !== null) return handle.runId
    return scanAt(index + 1)
  }
  return scanAt(0)
}
