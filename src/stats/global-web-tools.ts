// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { gte, sql } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { toolCallEvents, webCache } from '../db/schema.js'
import { keyedHash } from './hashing.js'
import type { ToolMixGlobal, WebFetchHostsGlobal } from './types.js'

const TOP_LIMIT = 20
const ONE_DAY_MS = 24 * 60 * 60 * 1000
const GROWTH_DAYS = 30

function extractHost(url: string): string | null {
  try {
    return new URL(url).host
  } catch {
    return null
  }
}

export function webFetchesGlobal(): WebFetchHostsGlobal {
  const rows = getDrizzleDb().select({ url: webCache.url }).from(webCache).all()

  const hostCounts = new Map<string, number>()
  for (const r of rows) {
    const host = extractHost(r.url)
    if (host === null) continue
    const h = keyedHash(`host:${host}`)
    hostCounts.set(h, (hostCounts.get(h) ?? 0) + 1)
  }

  const topHosts = [...hostCounts.entries()]
    .map(([hostHash, count]) => ({ hostHash, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_LIMIT)

  return { topHosts }
}

function queryTopTools(): ToolMixGlobal['topTools'] {
  const rows = getDrizzleDb()
    .select({
      toolName: toolCallEvents.toolName,
      total: sql<number>`count(*)`.as('total'),
      successes: sql<number>`sum(${toolCallEvents.success})`.as('successes'),
    })
    .from(toolCallEvents)
    .groupBy(toolCallEvents.toolName)
    .all()

  return rows
    .map((r) => ({ toolName: r.toolName, count: r.total, successRate: r.total === 0 ? 0 : r.successes / r.total }))
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_LIMIT)
}

function queryErrorTypeCounts(): Record<string, number> {
  const errorRows = getDrizzleDb()
    .select({ errorType: toolCallEvents.errorType, c: sql<number>`count(*)`.as('c') })
    .from(toolCallEvents)
    .where(sql`${toolCallEvents.errorType} is not null and ${toolCallEvents.errorType} != ''`)
    .groupBy(toolCallEvents.errorType)
    .all()

  const errorTypeCounts: Record<string, number> = {}
  for (const r of errorRows) if (r.errorType !== null) errorTypeCounts[r.errorType] = r.c
  return errorTypeCounts
}

function queryTotals(): { totalCalls: number; totalSuccessRate: number } {
  const totalsRow = getDrizzleDb()
    .select({
      total: sql<number>`count(*)`.as('total'),
      successes: sql<number>`sum(${toolCallEvents.success})`.as('successes'),
    })
    .from(toolCallEvents)
    .all()

  const totalCalls = totalsRow[0]?.total ?? 0
  const totalSuccesses = totalsRow[0]?.successes ?? 0
  return { totalCalls, totalSuccessRate: totalCalls === 0 ? 0 : totalSuccesses / totalCalls }
}

function queryGrowth30d(now: number): ToolMixGlobal['toolCallGrowth30d'] {
  const cutoff = now - GROWTH_DAYS * ONE_DAY_MS
  const growthRows = getDrizzleDb()
    .select({
      date: sql<string>`date(${toolCallEvents.occurredAt} / 1000, 'unixepoch')`.as('date'),
      count: sql<number>`count(*)`.as('count'),
    })
    .from(toolCallEvents)
    .where(gte(toolCallEvents.occurredAt, cutoff))
    .groupBy(sql`date(${toolCallEvents.occurredAt} / 1000, 'unixepoch')`)
    .orderBy(sql`date(${toolCallEvents.occurredAt} / 1000, 'unixepoch')`)
    .all()

  return growthRows.map((r) => ({ date: r.date, count: r.count }))
}

export function toolMixGlobal(now: number = Date.now()): ToolMixGlobal {
  const topTools = queryTopTools()
  const errorTypeCounts = queryErrorTypeCounts()
  const { totalCalls, totalSuccessRate } = queryTotals()
  const toolCallGrowth30d = queryGrowth30d(now)
  return { topTools, errorTypeCounts, totalCalls, totalSuccessRate, toolCallGrowth30d }
}
