// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq, isNotNull, lte, ne, or, type SQL } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { memoryRecords } from '../db/schema.js'
import { logger } from '../logger.js'
import type { MemoryKind } from './types.js'

const log = logger.child({ scope: 'long-term-memory-maintenance' })

const DAY_MS = 24 * 60 * 60 * 1000

const STALE_CUTOFFS = [
  ['preference', 180],
  ['procedure', 180],
  ['decision', 90],
  ['project_context', 90],
  ['person_context', 90],
  ['episode', 45],
  ['reference', 45],
  ['fact', 90],
] as const satisfies readonly (readonly [MemoryKind, number])[]

const cutoffIso = (now: Date, days: number): string => new Date(now.getTime() - days * DAY_MS).toISOString()

const staleKindCondition = (now: Date): SQL | undefined =>
  or(
    ...STALE_CUTOFFS.map(([kind, days]) =>
      and(eq(memoryRecords.kind, kind), lte(memoryRecords.lastSeenAt, cutoffIso(now, days))),
    ),
  )

const parseMaintenanceTime = (nowIso: string): Date => {
  const now = new Date(nowIso)
  if (Number.isNaN(now.getTime())) {
    throw new Error(`Invalid memory maintenance timestamp: ${nowIso}`)
  }
  return now
}

export function runMemoryMaintenance(nowIso = new Date().toISOString()): { staleMarked: number; archived: number } {
  const now = parseMaintenanceTime(nowIso)
  const db = getDrizzleDb()

  const archivedRows = db
    .update(memoryRecords)
    .set({ status: 'archived', updatedAt: nowIso })
    .where(
      and(
        ne(memoryRecords.status, 'archived'),
        isNotNull(memoryRecords.expiresAt),
        lte(memoryRecords.expiresAt, nowIso),
      ),
    )
    .returning({ id: memoryRecords.id })
    .all()

  const staleRows = db
    .update(memoryRecords)
    .set({ status: 'stale', updatedAt: nowIso })
    .where(and(eq(memoryRecords.status, 'active'), ne(memoryRecords.source, 'explicit'), staleKindCondition(now)))
    .returning({ id: memoryRecords.id })
    .all()

  const result = { staleMarked: staleRows.length, archived: archivedRows.length }
  log.info(result, 'Long-term memory maintenance complete')
  return result
}
