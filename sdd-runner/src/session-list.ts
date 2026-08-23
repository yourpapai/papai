// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readFileSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

import { SddEventSchema } from './events.js'
import type { DepthProfile, SddEvent, StageId } from './events.js'
import { PersistedRunStateSchema } from './run-state.js'
import { aggregateUsage } from './usage-aggregate.js'

/**
 * The session screen's display projection (D4): derived from each run's
 * state.json plus its event log — never persisted separately, so a row can
 * never disagree with the run it describes.
 */

export interface PendingDecision {
  readonly kind: 'gate'
  readonly mode: 'early' | 'final'
  readonly version: number
}

export interface SessionRow {
  readonly runId: string
  readonly changeName: string
  readonly status: 'running' | 'completed' | 'aborted' | 'failed' | 'stopped'
  readonly stage: StageId
  readonly depth: DepthProfile | null
  readonly round: number
  readonly roundCap: number
  readonly tokensIn: number
  readonly tokensOut: number
  readonly costUsd: number
  readonly costKnown: boolean
  readonly updatedAt: string
  readonly pendingDecision: PendingDecision | { readonly kind: 'stop' } | null
}

/** Bounded tail read (D4): long event logs contribute only their last lines. */
const TAIL_LINES = 400

function tailEvents(logPath: string): SddEvent[] {
  let raw: string
  try {
    raw = readFileSync(logPath, 'utf8')
  } catch {
    return []
  }
  const lines = raw
    .split('\n')
    .filter((line) => line.length > 0)
    .slice(-TAIL_LINES)
  const events: SddEvent[] = []
  for (const line of lines) {
    try {
      events.push(SddEventSchema.parse(JSON.parse(line)))
    } catch {
      break
    }
  }
  return events
}

function pendingDecisionOf(state: {
  gate: { mode: 'early' | 'final'; version: number } | null
  status: string
}): SessionRow['pendingDecision'] {
  if (state.status === 'stopped') return { kind: 'stop' }
  if (state.gate !== null && state.status === 'running') {
    return { kind: 'gate', mode: state.gate.mode, version: state.gate.version }
  }
  return null
}

/**
 * One display row per runnable entry under `runs/`, newest activity first.
 * Corrupt or mid-write run dirs are skipped — listing must not fail because
 * one run is unwritable, mirroring `listPendingGates`.
 */
export async function listSessions(workDir: string): Promise<SessionRow[]> {
  let entries: string[]
  try {
    entries = await readdir(path.join(workDir, 'runs'))
  } catch {
    return []
  }
  const rows = await Promise.all(
    entries.map(async (runId): Promise<SessionRow | null> => {
      try {
        const raw = await readFile(path.join(workDir, 'runs', runId, 'state.json'), 'utf8')
        const persisted = PersistedRunStateSchema.parse(JSON.parse(raw))
        const events = tailEvents(path.join(workDir, 'runs', runId, 'events.ndjson'))
        const usage = aggregateUsage(events)
        const tokensIn = usage.inputTokens + usage.cachedReadTokens + usage.cachedWriteTokens + usage.reasoningTokens
        return {
          runId,
          changeName: persisted.changeName,
          status: persisted.status,
          stage: persisted.stage,
          depth: persisted.depth,
          round: persisted.round,
          roundCap: persisted.roundCap ?? 1,
          tokensIn,
          tokensOut: usage.outputTokens,
          costUsd: usage.costUsd,
          costKnown: usage.costKnown,
          updatedAt: persisted.updatedAt,
          pendingDecision: pendingDecisionOf(persisted),
        }
      } catch {
        return null
      }
    }),
  )
  return rows.filter((row): row is SessionRow => row !== null).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}
