// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { safeParseLogBufferStats } from '../../src/debug/log-stats-schema.js'
import type { LogBufferStats } from '../../src/debug/log-stats-schema.js'
import type { LogEntry } from '../../src/debug/schemas.js'
import { parseLogEntry } from '../../src/debug/schemas.js'

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

/** Build a `/logs` URL. `limit` bounds the page size; `before` (ISO time) pages backward through the buffer. */
export function buildLogsUrl(params: { limit?: number; before?: string }): string {
  const search = new URLSearchParams()
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

export function fetchInitialLogs(limit: number = INITIAL_LIMIT): Promise<unknown[]> {
  return fetchLogsArray(buildLogsUrl({ limit }))
}

/** Fetch the page of buffered entries immediately older than `before` (the oldest currently-loaded timestamp). */
export function fetchOlderLogs(before: string, limit: number = OLDER_PAGE_LIMIT): Promise<unknown[]> {
  return fetchLogsArray(buildLogsUrl({ limit, before }))
}

export async function fetchLogStats(): Promise<LogBufferStats | null> {
  try {
    const res = await fetch('/logs/stats')
    if (!res.ok) return null
    return safeParseLogBufferStats(await res.json())
  } catch {
    return null
  }
}
