// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { AuthenticatedRequest } from '../dashboard-auth/index.js'
import { logBuffer, shapeLogEntry, type LogEntry } from './log-buffer.js'
import { parseLogFilter, entryMatchesFilter } from './log-filter-model.js'
import { isOwnLogEntry } from './state-collector.js'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
}

function parseIntParam(value: string | null): number | undefined {
  if (value === null) return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isNaN(parsed) ? undefined : parsed
}

function searchParam(value: string | null): string | undefined {
  if (value !== null) return value
  return undefined
}

/** Session-scoped egress: own entries verbatim, everything else shaped. */
function egressEntries(adminUserId: string): LogEntry[] {
  return logBuffer.entries().map((entry) => (isOwnLogEntry(entry, adminUserId) ? entry : shapeLogEntry(entry)))
}

export function handleLogs(url: URL, session: AuthenticatedRequest): Response {
  const filter = parseLogFilter(url.searchParams)
  // The connection filter (incl. q) runs after shaping so it can only ever
  // match post-shaping content; limit/before apply last for stable paging.
  let results = egressEntries(session.adminUserId).filter((entry) => entryMatchesFilter(entry, filter))
  const before = searchParam(url.searchParams.get('before'))
  if (before !== undefined) results = results.filter((e) => e.time < before)
  const limit = parseIntParam(url.searchParams.get('limit')) ?? 100
  return jsonResponse(results.slice(-limit))
}

export function handleLogScopes(): Response {
  return jsonResponse(logBuffer.distinctScopes())
}

export function handleLogStats(url: URL, session: AuthenticatedRequest): Response {
  const filter = parseLogFilter(url.searchParams)
  // matchingCount is computed over post-shaping content, same as /logs egress.
  const matchingCount = egressEntries(session.adminUserId).filter((entry) => entryMatchesFilter(entry, filter)).length
  return jsonResponse({ ...logBuffer.stats(), matchingCount })
}
