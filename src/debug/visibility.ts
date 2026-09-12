// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { LogEntry } from './log-buffer.js'
import { recentTurns, inFlightTurns, findTurnById } from './turn-assembly.js'

export type AdminVisibility = {
  adminUserId: string
  groupIds: ReadonlySet<string>
}

export function isVisibleToAdmin(
  scope: { kind?: string; userId?: string; groupId?: string } | null | undefined,
  vis: AdminVisibility,
): boolean {
  if (scope === null || scope === undefined || typeof scope.kind !== 'string') return false
  if (scope.kind === 'global') return true
  if (scope.kind === 'user') return scope.userId === vis.adminUserId
  if (scope.kind === 'group') return scope.groupId !== undefined && vis.groupIds.has(scope.groupId)
  return false
}

export function clientVisibility(adminUserId: string | undefined): AdminVisibility {
  return { adminUserId: adminUserId ?? '', groupIds: new Set() }
}

/**
 * Turn ids whose scope is visible to the session admin, resolved in a single
 * pass over the turn buffers — the per-request attribution index for bulk log
 * egress (O(turns) once, not O(entries x turns)).
 * @public -- shared by the REST /logs route so bulk egress avoids per-entry scans.
 */
export function ownTurnIdsForAdmin(adminUserId: string | undefined): Set<string> {
  const own = new Set<string>()
  if (adminUserId === undefined) return own
  const vis = clientVisibility(adminUserId)
  for (const turn of inFlightTurns.values()) {
    if (isVisibleToAdmin(turn.scope, vis)) own.add(turn.turnId)
  }
  for (const turn of recentTurns) {
    if (isVisibleToAdmin(turn.scope, vis)) own.add(turn.turnId)
  }
  return own
}

/**
 * Attribution check for log egress: an entry is the client admin's own when it
 * carries an explicit matching `chatUserId`, or when its `turnId` resolves to a
 * turn whose scope is visible to that admin. Everything else — foreign or
 * unattributable — must be shaped.
 * @public -- shared by the REST /logs route so SSE and REST egress agree.
 * `ownTurnIds`, when provided, is the pre-resolved per-request attribution set
 * (see `ownTurnIdsForAdmin`); without it the single-entry path falls back to a
 * `findTurnById` lookup.
 */
export function isOwnLogEntry(
  entry: LogEntry,
  adminUserId: string | undefined,
  ownTurnIds?: ReadonlySet<string>,
): boolean {
  if (adminUserId === undefined) return false
  const explicit = entry['chatUserId']
  if (typeof explicit === 'string') return explicit === adminUserId
  const turnId = entry['turnId']
  if (typeof turnId === 'string' && turnId !== '') {
    if (ownTurnIds !== undefined) return ownTurnIds.has(turnId)
    const turn = findTurnById(turnId)
    if (turn !== undefined && isVisibleToAdmin(turn.scope, clientVisibility(adminUserId))) return true
  }
  return false
}
