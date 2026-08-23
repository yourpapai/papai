// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { Tool } from 'ai'
import { z } from 'zod'

import { logBuffer, shapeLogEntry, type LogEntry } from '../debug/log-buffer.js'
import { entryMatchesFilter, type LogFilter } from '../debug/log-filter-model.js'
import { isOwnLogEntry, ownTurnIdsForAdmin } from '../debug/visibility.js'
import { logger } from '../logger.js'
import { PROBE_ERROR, runProbe } from './diagnostics.js'

const log = logger.child({ scope: 'tool:read-recent-logs' })

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

export type ScopeCount = { scope: string; count: number }

export type LogBufferStats = {
  count: number
  capacity: number
  oldest: string | null
  newest: string | null
}

export type ReadRecentLogsDeps = Partial<
  Readonly<{
    entries: () => LogEntry[]
    stats: () => LogBufferStats
    distinctScopes: () => ScopeCount[]
    ownTurnIds: (adminUserId: string | undefined) => ReadonlySet<string>
  }>
>

const resolveDeps = (deps: ReadRecentLogsDeps): Required<ReadRecentLogsDeps> => ({
  entries: deps.entries ?? (() => logBuffer.entries()),
  stats: deps.stats ?? (() => logBuffer.stats()),
  distinctScopes: deps.distinctScopes ?? (() => logBuffer.distinctScopes()),
  ownTurnIds: deps.ownTurnIds ?? ((adminUserId: string | undefined) => ownTurnIdsForAdmin(adminUserId)),
})

type LogsFilterInput = {
  level?: number | undefined
  scope?: string | undefined
  msg?: string | undefined
  turn_id?: string | undefined
}

function toLogFilter(input: LogsFilterInput): LogFilter {
  const filter: LogFilter = { include: [], exclude: [], level: input.level ?? 0 }
  if (input.scope !== undefined) filter.include = [input.scope]
  if (input.turn_id !== undefined) filter.turnId = input.turn_id
  if (input.msg !== undefined) filter.q = input.msg
  return filter
}

/**
 * Shape-then-filter egress over the raw buffer, mirroring `handleLogs`: own
 * entries verbatim, everything else shaped, caller filters applied to
 * post-shaping content only, then the tail sliced to the clamped limit.
 */
function collectEntries(
  resolved: Required<ReadRecentLogsDeps>,
  chatUserId: string | undefined,
  input: LogsFilterInput & { limit?: number | undefined },
): LogEntry[] | typeof PROBE_ERROR {
  const ownTurnIds = runProbe('read_recent_logs', 'own_turn_ids', () => resolved.ownTurnIds(chatUserId))
  const attribution: ReadonlySet<string> = ownTurnIds === PROBE_ERROR ? new Set<string>() : ownTurnIds
  const raw = runProbe('read_recent_logs', 'entries', resolved.entries)
  if (raw === PROBE_ERROR) return PROBE_ERROR
  return raw
    .map((entry) => (isOwnLogEntry(entry, chatUserId, attribution) ? entry : shapeLogEntry(entry)))
    .filter((entry) => entryMatchesFilter(entry, toLogFilter(input)))
    .slice(-Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT))
}

type ReadRecentLogsResult =
  | {
      entries: LogEntry[] | typeof PROBE_ERROR
      stats: LogBufferStats | typeof PROBE_ERROR
      history_starts_at_process_start: true
    }
  | {
      scopes: ScopeCount[] | typeof PROBE_ERROR
      stats: LogBufferStats | typeof PROBE_ERROR
      history_starts_at_process_start: true
    }

const readRecentLogsInputSchema = z.object({
  level: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Minimum pino numeric level to include (>=), e.g. 30 for info, 40 for warn'),
  scope: z.string().min(1).optional().describe('Scope allowlist pattern, e.g. "chat" or "chat:*"'),
  msg: z.string().min(1).optional().describe('Case-insensitive substring match applied to post-shaping entry content'),
  turn_id: z.string().min(1).optional().describe('Only entries attributed to this turn id'),
  limit: z.number().int().min(1).optional().describe('Maximum number of entries to return; default 50, clamped to 200'),
  distinct_scopes: z.boolean().optional().describe('Return distinct scope names with counts instead of log entries'),
})

/**
 * Read-only view over the in-process log ring buffer for bot admins. Egress
 * mirrors the dashboard `GET /logs` contract exactly: own entries pass
 * verbatim, foreign/unattributed entries are shaped to structural plus
 * numeric/boolean fields, and caller filters run against post-shaping content
 * only — never raw buffer content.
 */
export function makeReadRecentLogsTool(chatUserId: string | undefined, deps: ReadRecentLogsDeps = {}): Tool {
  const resolved = resolveDeps(deps)
  return tool({
    description:
      "Read recent bot log entries from the in-process ring buffer. Own entries return verbatim; other users' entries are reduced to structural and numeric/boolean fields only. History starts at process start. Admin-only; returns no secrets.",
    inputSchema: readRecentLogsInputSchema,
    execute: ({ level, scope, msg, turn_id, limit, distinct_scopes }): Promise<ReadRecentLogsResult> => {
      const stats = runProbe('read_recent_logs', 'stats', resolved.stats)
      if (distinct_scopes === true) {
        const scopes = runProbe('read_recent_logs', 'scopes', resolved.distinctScopes)
        log.info({ tool: 'read_recent_logs', distinct_scopes: true }, 'Distinct log scopes collected')
        return Promise.resolve({ scopes, stats, history_starts_at_process_start: true })
      }
      const entries = collectEntries(resolved, chatUserId, { level, scope, msg, turn_id, limit })
      log.info({ tool: 'read_recent_logs', requestedLimit: limit ?? DEFAULT_LIMIT }, 'Recent logs read')
      return Promise.resolve({ entries, stats, history_starts_at_process_start: true })
    },
  })
}
