// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq, isNull, lte, or, sql } from 'drizzle-orm'

import type { ContextType } from '../chat/types.js'
import { getDrizzleDb } from '../db/drizzle.js'
import { memoryExtractionState, type MemoryExtractionStateRow } from '../db/schema.js'

// ~10 min — matches MEMORY_CAPTURE_DEBOUNCE_MS
export const DEFAULT_IDLE_MS = 600_000

export type ActivityInput = Readonly<{
  contextId: string
  contextType: ContextType
  configContextId: string
  historyLen: number
}>

export function markActivity(input: ActivityInput, now: string): void {
  getDrizzleDb()
    .insert(memoryExtractionState)
    .values({
      contextId: input.contextId,
      contextType: input.contextType,
      configContextId: input.configContextId,
      lastActivityAt: now,
      lastHistoryLen: input.historyLen,
    })
    .onConflictDoUpdate({
      target: memoryExtractionState.contextId,
      set: {
        contextType: input.contextType,
        configContextId: input.configContextId,
        lastActivityAt: now,
        lastHistoryLen: input.historyLen,
      },
    })
    .run()
}

export function markExtracted(contextId: string, historyLen: number, now: string): void {
  getDrizzleDb()
    .update(memoryExtractionState)
    .set({ lastExtractedAt: now, lastHistoryLen: historyLen })
    .where(eq(memoryExtractionState.contextId, contextId))
    .run()
}

/** Contexts with unextracted activity that have been idle for at least `idleMs`. */
export function listDirtyContexts(now: string, idleMs: number = DEFAULT_IDLE_MS): readonly MemoryExtractionStateRow[] {
  const cutoff = new Date(new Date(now).getTime() - idleMs).toISOString()
  return getDrizzleDb()
    .select()
    .from(memoryExtractionState)
    .where(
      and(
        lte(memoryExtractionState.lastActivityAt, cutoff),
        or(
          isNull(memoryExtractionState.lastExtractedAt),
          sql`${memoryExtractionState.lastActivityAt} > ${memoryExtractionState.lastExtractedAt}`,
        ),
      ),
    )
    .all()
}
