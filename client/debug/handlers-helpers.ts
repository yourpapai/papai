// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Turn } from '../../src/debug/schemas.js'

export const CAPS = {
  LOG: 65535,
  NOTIFICATION: 2048,
  TOOL_FAILURE: 1024,
  TURN: 512,
  RECURRING: 512,
  DEFERRED: 512,
  MEMO: 1024,
  TRACE: 1024,
} as const

const VALID_TURN_STATUSES: ReadonlySet<string> = new Set(['running', 'ok', 'error', 'cancelled'])

export function isValidTurnStatus(s: string): s is Turn['status'] {
  return VALID_TURN_STATUSES.has(s)
}

export function parseScope(value: unknown): Turn['scope'] {
  if (typeof value !== 'object' || value === null || !('kind' in value)) return { kind: 'global' }
  const obj = value as Record<string, unknown>
  const kind = obj['kind']
  if (kind !== 'user' && kind !== 'group' && kind !== 'global') return { kind: 'global' }
  const scope: Turn['scope'] = { kind }
  if (typeof obj['userId'] === 'string') scope.userId = obj['userId']
  if (typeof obj['groupId'] === 'string') scope.groupId = obj['groupId']
  if (typeof obj['threadId'] === 'string') scope.threadId = obj['threadId']
  return scope
}

export function pickString(d: Record<string, unknown>, key: string): string {
  const v = d[key]
  return typeof v === 'string' ? v : ''
}
