// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ModelMessage } from 'ai'

import { getCachedHistory } from '../cache.js'
import { logger } from '../logger.js'
import { runMemoryCapture, type RunMemoryCaptureInput } from './capture.js'
import { DEFAULT_IDLE_MS, listDirtyContexts } from './extraction-state.js'

const log = logger.child({ scope: 'memory:capture-sweep' })

export type SweepDeps = Readonly<{
  idleMs: number
  loadHistory: (storageContextId: string) => readonly ModelMessage[]
  runCapture: (input: RunMemoryCaptureInput) => Promise<void>
}>

const defaultDeps: SweepDeps = {
  idleMs: DEFAULT_IDLE_MS,
  loadHistory: (storageContextId) => getCachedHistory(storageContextId),
  runCapture: (input) => runMemoryCapture(input),
}

export async function sweepDirtyContexts(now: string, deps: SweepDeps = defaultDeps): Promise<void> {
  const dirty = listDirtyContexts(now, deps.idleMs)
  const runs = dirty.map(async (row) => {
    const history = deps.loadHistory(row.contextId)
    if (history.length === 0) return
    try {
      await deps.runCapture({
        storageContextId: row.contextId,
        configContextId: row.configContextId,
        contextType: row.contextType,
        history,
      })
    } catch (error) {
      log.warn(
        { contextId: row.contextId, error: error instanceof Error ? error.message : String(error) },
        'Sweep capture failed',
      )
    }
  })
  await Promise.all(runs)
}
