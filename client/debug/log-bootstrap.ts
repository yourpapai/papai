// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { safeParseLogBufferStats } from '../../src/debug/log-stats-schema.js'
import type { LogBufferStats } from '../../src/debug/log-stats-schema.js'
import type { LogEntry } from '../../src/debug/schemas.js'
import { parseLogEntry } from '../../src/debug/schemas.js'
import { filterToParams, type LogFilter } from './log-filter-url.js'

export type { LogBufferStats } from '../../src/debug/log-stats-schema.js'

export function parseLogsArray(logs: readonly unknown[]): LogEntry[] {
  const parsedLogs: LogEntry[] = []
  for (const log of logs) {
    try {
      parsedLogs.push(parseLogEntry(log))
    } catch {
      // Skip invalid entries
    }
  }
  return parsedLogs
}

export function collectScopes(logs: readonly LogEntry[]): Set<string> {
  const scopes = new Set<string>()
  for (const entry of logs) {
    if (entry.scope !== undefined) scopes.add(entry.scope)
  }
  return scopes
}

const INITIAL_LIMIT = 500
const OLDER_PAGE_LIMIT = 200

/** Build a `/logs` URL. `limit` bounds the page size; `before` pages backward; `filter` scopes the query server-side. */
export function buildLogsUrl(params: { limit?: number; before?: string; filter?: LogFilter }): string {
  const search = params.filter ? filterToParams(params.filter) : new URLSearchParams()
  search.set('limit', String(params.limit ?? INITIAL_LIMIT))
  if (params.before !== undefined) search.set('before', params.before)
  return `/logs?${search.toString()}`
}

async function fetchLogsArray(urlPath: string): Promise<unknown[]> {
  const res = await fetch(urlPath)
  if (!res.ok) return []
  const body: unknown = await res.json()
  if (!Array.isArray(body)) return []
  return body as unknown[]
}

export function fetchInitialLogs(filter?: LogFilter, limit: number = INITIAL_LIMIT): Promise<unknown[]> {
  return fetchLogsArray(buildLogsUrl({ limit, filter }))
}

/** Fetch the page of buffered entries immediately older than `before` (the oldest currently-loaded timestamp). */
export function fetchOlderLogs(
  before: string,
  filter?: LogFilter,
  limit: number = OLDER_PAGE_LIMIT,
): Promise<unknown[]> {
  return fetchLogsArray(buildLogsUrl({ limit, before, filter }))
}

export async function fetchLogStats(filter?: LogFilter): Promise<LogBufferStats | null> {
  try {
    const params = filter ? filterToParams(filter) : new URLSearchParams()
    const res = await fetch(`/logs/stats?${params.toString()}`)
    if (!res.ok) return null
    return safeParseLogBufferStats(await res.json())
  } catch {
    return null
  }
}

export type ScopeCount = { scope: string; count: number }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isScopeCount(r: unknown): r is ScopeCount {
  if (!isRecord(r)) return false
  return typeof r['scope'] === 'string' && typeof r['count'] === 'number'
}

export async function fetchScopes(): Promise<ScopeCount[]> {
  try {
    const res = await fetch('/logs/scopes')
    if (!res.ok) return []
    const body: unknown = await res.json()
    if (!Array.isArray(body)) return []
    return body.filter((r): r is ScopeCount => isScopeCount(r))
  } catch {
    return []
  }
}
