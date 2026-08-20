// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'

import { readEvents, SddEventSchema } from './events.js'
import type { SddEvent } from './events.js'
import { createReplayFolder } from './replay.js'
import type { ReplayState } from './replay.js'
import { loadRunState, resolveRunId } from './run-state.js'
import type { RunState } from './run-state.js'
import { foldFindings, foldSlots } from './watch-view.js'
import type { SlotState, WatchFinding } from './watch-view.js'

const IDLE_EXIT_MS = 60_000

export interface WatchFrame {
  readonly state: ReplayState
  readonly slots: readonly SlotState[]
  readonly findings: readonly WatchFinding[]
  readonly done: boolean
  readonly idleExit: boolean
}

export interface Watcher {
  /** Replay the existing log exactly once; records the consumed byte offset. */
  readonly replay: () => Promise<WatchFrame>
  /** Fold only bytes past the recorded offset (500ms cadence from the caller). */
  readonly poll: () => Promise<WatchFrame>
}

function isTerminal(status: RunState['status']): boolean {
  return status === 'completed' || status === 'aborted' || status === 'failed'
}

/** Idle-exit predicate: 60s with no new events on an already-terminal log. */
export function isIdleExit(input: {
  readonly lastEventAt: number
  readonly now: number
  readonly terminal: boolean
}): boolean {
  return input.terminal && input.now - input.lastEventAt >= IDLE_EXIT_MS
}

interface FoldBag {
  slots: readonly SlotState[]
  findings: readonly WatchFinding[]
  lastEventAt: number
}

function foldChunkInto(folder: ReturnType<typeof createReplayFolder>, bag: FoldBag, chunk: string): void {
  for (const line of chunk.split('\n')) {
    if (line.trim().length === 0) continue
    const event: SddEvent = parseEventLine(line)
    folder.fold(event)
    bag.slots = foldSlots(bag.slots, event)
    bag.findings = foldFindings(bag.findings, event)
    bag.lastEventAt = new Date(event.ts).getTime()
  }
}

function parseEventLine(line: string): SddEvent {
  const parsed: unknown = JSON.parse(line)
  return SddEventSchema.parse(parsed)
}

/**
 * Replay-then-tail engine (D8): replay `events.ndjson` via
 * `createReplayFolder`, record the consumed byte offset, then tail by
 * polling `fs.stat` mtime/size, folding only bytes past the offset — the
 * offset handoff means an event appended between replay and the first poll
 * is folded exactly once. Read-only with respect to the run dir; the run id
 * resolves via the path-traversal-safe `resolveRunId` with path separators
 * rejected up front.
 */
export function createWatcher(workDir: string, runIdArg: string): Watcher {
  if (runIdArg.includes('/') || runIdArg.includes('\\')) {
    throw new Error(`run id must not contain path separators: ${runIdArg}`)
  }
  const folder = createReplayFolder()
  const bag = { slots: [] as readonly SlotState[], findings: [] as readonly WatchFinding[], lastEventAt: 0 }
  let offset = 0
  let runId: string | null = null

  const logPathOf = (): string => path.join(workDir, 'runs', runId ?? runIdArg, 'events.ndjson')

  const foldChunk = (chunk: string): void => {
    foldChunkInto(folder, bag, chunk)
  }

  const frame = (done: boolean, idleExit: boolean): WatchFrame => ({
    state: folder.state,
    slots: bag.slots,
    findings: bag.findings,
    done,
    idleExit,
  })

  return {
    replay: async () => {
      runId = await resolveRunId(workDir, runIdArg)
      const log = await readFile(logPathOf(), 'utf8')
      offset = Buffer.byteLength(log, 'utf8')
      foldChunk(log)
      return frame(false, false)
    },
    poll: async () => {
      const info = await stat(logPathOf()).catch(() => null)
      if (info !== null && info.size > offset) {
        const handle = await readFile(logPathOf(), 'utf8')
        const chunk = Buffer.from(handle, 'utf8').subarray(offset).toString('utf8')
        offset = Buffer.byteLength(handle, 'utf8')
        foldChunk(chunk)
      }
      const state = await loadRunState(workDir, runId ?? runIdArg).catch(() => null)
      const terminal = state !== null && isTerminal(state.status)
      const idle = isIdleExit({ lastEventAt: bag.lastEventAt, now: Date.now(), terminal })
      return frame(terminal, idle)
    },
  }
}

export { readEvents }
