// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { sql } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { authorizedGroups, llmUsageEvents, messageMetadata, users } from '../db/schema.js'
import { parseIsoToMs } from './internal/util.js'
import type { ActiveSubjectCounts, GlobalSubjects, SubjectGrowthPoint } from './types.js'

const ONE_DAY_MS = 24 * 60 * 60 * 1000
const GROWTH_DAYS = 30

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

function accumulateDayCounts(
  rows: ReadonlyArray<{ addedAt: string }>,
  counts: Map<string, number>,
  cutoff: number,
  now: number,
): void {
  for (const r of rows) {
    const ms = parseIsoToMs(r.addedAt)
    if (ms === null || ms < cutoff || ms > now) continue
    const d = isoDate(ms)
    counts.set(d, (counts.get(d) ?? 0) + 1)
  }
}

function buildGrowthPoints(now: number): SubjectGrowthPoint[] {
  const dmRows = getDrizzleDb().select({ addedAt: users.addedAt }).from(users).all()
  const groupRows = getDrizzleDb().select({ addedAt: authorizedGroups.addedAt }).from(authorizedGroups).all()

  const dmCounts = new Map<string, number>()
  const groupCounts = new Map<string, number>()
  const cutoff = now - GROWTH_DAYS * ONE_DAY_MS

  accumulateDayCounts(dmRows, dmCounts, cutoff, now)
  accumulateDayCounts(groupRows, groupCounts, cutoff, now)

  const dates = new Set<string>([...dmCounts.keys(), ...groupCounts.keys()])
  return [...dates]
    .sort()
    .map((date) => ({ date, dmAdded: dmCounts.get(date) ?? 0, groupAdded: groupCounts.get(date) ?? 0 }))
}

export function subjectsGlobal(now: number = Date.now()): GlobalSubjects {
  const dmRow = getDrizzleDb()
    .select({ c: sql<number>`count(*)`.as('c') })
    .from(users)
    .all()
  const groupRow = getDrizzleDb()
    .select({ c: sql<number>`count(*)`.as('c') })
    .from(authorizedGroups)
    .all()

  return {
    dmTotal: dmRow[0]?.c ?? 0,
    groupTotal: groupRow[0]?.c ?? 0,
    growthLast30d: buildGrowthPoints(now),
  }
}

function activeSubjectsSince(cutoff: number): Set<string> {
  const ids = new Set<string>()
  const usage = getDrizzleDb()
    .select({ id: llmUsageEvents.storageContextId })
    .from(llmUsageEvents)
    .where(sql`${llmUsageEvents.occurredAt} >= ${cutoff}`)
    .all()
  for (const r of usage) ids.add(r.id)
  const msgs = getDrizzleDb()
    .select({ id: messageMetadata.contextId })
    .from(messageMetadata)
    .where(sql`${messageMetadata.timestamp} >= ${cutoff}`)
    .all()
  for (const r of msgs) ids.add(r.id)
  return ids
}

export function activeSubjectCounts(now: number = Date.now()): ActiveSubjectCounts {
  return {
    activeIn1d: activeSubjectsSince(now - ONE_DAY_MS).size,
    activeIn7d: activeSubjectsSince(now - 7 * ONE_DAY_MS).size,
    activeIn30d: activeSubjectsSince(now - 30 * ONE_DAY_MS).size,
  }
}
