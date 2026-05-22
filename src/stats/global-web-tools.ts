// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { sql } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { toolCallEvents, webCache } from '../db/schema.js'
import { keyedHash } from './hashing.js'
import type { ToolMixGlobal, WebFetchHostsGlobal } from './types.js'

const TOP_LIMIT = 20

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

export function toolMixGlobal(): ToolMixGlobal {
  const rows = getDrizzleDb()
    .select({
      toolName: toolCallEvents.toolName,
      total: sql<number>`count(*)`.as('total'),
      successes: sql<number>`sum(${toolCallEvents.success})`.as('successes'),
    })
    .from(toolCallEvents)
    .groupBy(toolCallEvents.toolName)
    .all()

  const topTools = rows
    .map((r) => ({
      toolName: r.toolName,
      count: r.total,
      successRate: r.total === 0 ? 0 : r.successes / r.total,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_LIMIT)

  const errorRows = getDrizzleDb()
    .select({ errorType: toolCallEvents.errorType, c: sql<number>`count(*)`.as('c') })
    .from(toolCallEvents)
    .where(sql`${toolCallEvents.errorType} is not null and ${toolCallEvents.errorType} != ''`)
    .groupBy(toolCallEvents.errorType)
    .all()

  const errorTypeCounts: Record<string, number> = {}
  for (const r of errorRows) if (r.errorType !== null) errorTypeCounts[r.errorType] = r.c

  return { topTools, errorTypeCounts }
}
