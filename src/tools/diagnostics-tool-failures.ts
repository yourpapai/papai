// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { Tool } from 'ai'
import { z } from 'zod'

import { recentToolFailures, RECENT_TOOL_FAILURES_CAPACITY, type ToolFailure } from '../debug/turn-assembly.js'
import { clientVisibility, isVisibleToAdmin } from '../debug/visibility.js'
import { logger } from '../logger.js'
import { type BufferStats, PROBE_ERROR, runProbe, tailStats } from './diagnostics.js'

const log = logger.child({ scope: 'tool:read-recent-tool-failures' })

const DEFAULT_LIMIT = 25
const MAX_LIMIT = RECENT_TOOL_FAILURES_CAPACITY

export type ReadRecentToolFailuresDeps = Partial<
  Readonly<{
    failures: () => ToolFailure[]
  }>
>

const resolveDeps = (deps: ReadRecentToolFailuresDeps): Required<ReadRecentToolFailuresDeps> => ({
  failures: deps.failures ?? (() => recentToolFailures.slice()),
})

/** Buffer-wide volatility stats derived structurally from the failure array. */
const failureStats = (failures: ToolFailure[]): BufferStats =>
  tailStats(failures, RECENT_TOOL_FAILURES_CAPACITY, (f) => f.timestamp)

/**
 * Whitelisted egress shape for a buffered tool-failure record: timestamp,
 * scope, and the classified failure fields only — never the raw `data` bag
 * (tool arguments, provider bodies, or chat identities).
 */
function toFailurePayload(entry: ToolFailure): Record<string, unknown> {
  const payload: Record<string, unknown> = { timestamp: entry.timestamp, scope: entry.scope }
  const toolName = entry.data['toolName']
  if (typeof toolName === 'string') payload['toolName'] = toolName
  const durationMs = entry.data['durationMs']
  if (typeof durationMs === 'number') payload['durationMs'] = durationMs
  const ok = entry.data['ok']
  if (typeof ok === 'boolean') payload['ok'] = ok
  const failureReason = entry.data['failureReason']
  if (typeof failureReason === 'string' && failureReason !== '') payload['failureReason'] = failureReason
  const turnId = entry.data['turnId']
  if (typeof turnId === 'string' && turnId !== '') payload['turnId'] = turnId
  return payload
}

/**
 * Visibility-filtered whitelist egress, mirroring the dashboard init frame:
 * entries whose scope is invisible to the admin are absent and the tail is
 * sliced to the clamped limit.
 */
function listVisibleFailures(
  raw: ToolFailure[],
  chatUserId: string | undefined,
  limit: number | undefined,
): Array<Record<string, unknown>> {
  const vis = clientVisibility(chatUserId)
  return raw
    .filter((f) => isVisibleToAdmin(f.scope, vis))
    .slice(-Math.min(limit ?? DEFAULT_LIMIT, MAX_LIMIT))
    .map(toFailurePayload)
}

const readRecentToolFailuresInputSchema = z.object({
  limit: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('Maximum number of failure entries to return; default 25, clamped to the buffer capacity'),
})

type ReadRecentToolFailuresResult = {
  failures: Array<Record<string, unknown>> | typeof PROBE_ERROR
  stats: BufferStats | typeof PROBE_ERROR
}

/**
 * Read-only view over the in-process tool-failure buffer for bot admins:
 * whitelisted failure-classification fields for entries visible to the admin,
 * never tool arguments or provider bodies.
 */
export function makeReadRecentToolFailuresTool(
  chatUserId: string | undefined,
  deps: ReadRecentToolFailuresDeps = {},
): Tool {
  const resolved = resolveDeps(deps)
  return tool({
    description:
      'Read recent tool-call failures from the in-process buffer: timestamp, scope, tool name, duration, success flag, failure reason, and turn id for entries visible to you. Admin-only; returns no tool arguments or results.',
    inputSchema: readRecentToolFailuresInputSchema,
    execute: ({ limit }): Promise<ReadRecentToolFailuresResult> => {
      const raw = runProbe('read_recent_tool_failures', 'failures', resolved.failures)
      const result =
        raw === PROBE_ERROR
          ? { failures: PROBE_ERROR, stats: PROBE_ERROR }
          : { failures: listVisibleFailures(raw, chatUserId, limit), stats: failureStats(raw) }
      log.info(
        { tool: 'read_recent_tool_failures', requestedLimit: limit ?? DEFAULT_LIMIT },
        'Recent tool failures read',
      )
      return Promise.resolve(result)
    },
  })
}
