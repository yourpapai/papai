// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { Tool } from 'ai'
import { z } from 'zod'

import { findTurnById, recentTurns, RECENT_TURNS_CAPACITY, type Turn } from '../debug/turn-assembly.js'
import { clientVisibility, isVisibleToAdmin } from '../debug/visibility.js'
import { logger } from '../logger.js'
import { PROBE_ERROR, runProbe } from './diagnostics.js'

const log = logger.child({ scope: 'tool:read-recent-turns' })

const DEFAULT_LIMIT = 25
const MAX_LIMIT = RECENT_TURNS_CAPACITY

export type TurnBufferStats = {
  count: number
  capacity: number
  oldest: number | null
  newest: number | null
}

export type ReadRecentTurnsDeps = Partial<
  Readonly<{
    turns: () => Turn[]
    findTurnById: (turnId: string) => Turn | undefined
  }>
>

const resolveDeps = (deps: ReadRecentTurnsDeps): Required<ReadRecentTurnsDeps> => ({
  turns: deps.turns ?? (() => recentTurns.slice()),
  findTurnById: deps.findTurnById ?? findTurnById,
})

/** Buffer-wide volatility stats derived structurally from the turn array. */
function turnStats(turns: Turn[]): TurnBufferStats {
  return {
    count: turns.length,
    capacity: RECENT_TURNS_CAPACITY,
    oldest: turns[0]?.startedAt ?? null,
    newest: turns[turns.length - 1]?.startedAt ?? null,
  }
}

/** Anonymous per-turn payload copy: the buffered record is never handed out by reference. */
function anonymousTurn(turn: Turn): Turn {
  return { ...turn, toolCalls: turn.toolCalls.map((call) => ({ ...call })) }
}

/**
 * Visibility-filtered listing, mirroring the dashboard init frame: turns whose
 * scope is invisible to the admin are absent, the status filter applies over
 * visible turns only, and the tail is sliced to the clamped limit.
 */
function listVisibleTurns(
  raw: Turn[],
  chatUserId: string | undefined,
  input: { status?: Turn['status'] | undefined; limit?: number | undefined },
): Turn[] {
  const vis = clientVisibility(chatUserId)
  return raw
    .filter((t) => isVisibleToAdmin(t.scope, vis))
    .filter((t) => input.status === undefined || t.status === input.status)
    .slice(-Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT))
}

/**
 * No-existence-leak single-turn fetch: foreign, invisible, and unknown ids all
 * return the same `not_found` shape, like `get_message`.
 */
function fetchTurn(
  resolved: Required<ReadRecentTurnsDeps>,
  chatUserId: string | undefined,
  turnId: string,
): { found: true; turn: Turn } | { found: false } | typeof PROBE_ERROR {
  const found = runProbe('read_recent_turns', 'find_turn_by_id', () => resolved.findTurnById(turnId))
  if (found === PROBE_ERROR) return PROBE_ERROR
  if (found === undefined) return { found: false }
  if (!isVisibleToAdmin(found.scope, clientVisibility(chatUserId))) return { found: false }
  return { found: true, turn: anonymousTurn(found) }
}

const readRecentTurnsInputSchema = z.object({
  status: z.enum(['running', 'ok', 'error', 'cancelled']).optional().describe('Only turns with this status'),
  turn_id: z.string().min(1).optional().describe('Fetch a single turn by id; foreign or unknown ids return not_found'),
  limit: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('Maximum number of turns to return; default 25, clamped to the turn buffer capacity'),
})

type ReadRecentTurnsResult =
  | { turns: Turn[] | typeof PROBE_ERROR; stats: TurnBufferStats | typeof PROBE_ERROR }
  | {
      status: 'ok' | 'not_found' | 'probe_error'
      turn?: Turn
      stats: TurnBufferStats | typeof PROBE_ERROR
    }

/**
 * Read-only view over the in-process turn buffers for bot admins. Listings
 * carry only anonymous operational data for turns visible to the admin; a
 * single-turn fetch never discloses the existence of other users' turns.
 */
export function makeReadRecentTurnsTool(chatUserId: string | undefined, deps: ReadRecentTurnsDeps = {}): Tool {
  const resolved = resolveDeps(deps)
  return tool({
    description:
      'Read recent conversation turns from the in-process turn buffer: timings, status, tool names/durations, and failure reasons for turns visible to you. Use turn_id to fetch a single turn; foreign or unknown ids return not_found. Admin-only; returns no message content.',
    inputSchema: readRecentTurnsInputSchema,
    execute: ({ status, turn_id, limit }): Promise<ReadRecentTurnsResult> => {
      const raw = runProbe('read_recent_turns', 'turns', resolved.turns)
      const stats = raw === PROBE_ERROR ? PROBE_ERROR : turnStats(raw)
      if (turn_id !== undefined) {
        const fetched = fetchTurn(resolved, chatUserId, turn_id)
        log.info({ tool: 'read_recent_turns', fetch: true }, 'Recent turn fetched')
        if (fetched === PROBE_ERROR) return Promise.resolve({ status: 'probe_error', stats })
        if (fetched.found) return Promise.resolve({ status: 'ok', turn: fetched.turn, stats })
        return Promise.resolve({ status: 'not_found', stats })
      }
      const turns = raw === PROBE_ERROR ? PROBE_ERROR : listVisibleTurns(raw, chatUserId, { status, limit })
      log.info({ tool: 'read_recent_turns', requestedLimit: limit ?? DEFAULT_LIMIT }, 'Recent turns read')
      return Promise.resolve({ turns, stats })
    },
  })
}
