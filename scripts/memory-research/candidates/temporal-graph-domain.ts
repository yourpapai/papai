// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ForgetRequest, MemoryEvent, MemoryScope } from '../types.js'
import { sameScope } from './shared.js'

export type GraphTombstone =
  | Readonly<{ kind: 'evidence'; scope: MemoryScope; targetId: string; completedAt: string }>
  | Readonly<{ kind: 'subject'; scope: MemoryScope; targetId: string; completedAt: string }>
  | Readonly<{ kind: 'scope'; scope: MemoryScope; targetId: null; completedAt: string }>

export type EpochInterval = Readonly<{
  validFromMs: number
  validToMs: number | null
}>

const earlierEnd = (left: number | null, right: number | null): number | null => {
  if (left === null) return right
  if (right === null) return left
  return Math.min(left, right)
}

export const eventEpochInterval = (event: MemoryEvent): EpochInterval => ({
  validFromMs: Date.parse(event.validity.validFrom),
  validToMs: event.validity.validTo === null ? null : Date.parse(event.validity.validTo),
})

export const relationEpochInterval = (
  event: MemoryEvent,
  relation: MemoryEvent['relations'][number],
): EpochInterval | null => {
  const eventInterval = eventEpochInterval(event)
  const validFromMs = Math.max(eventInterval.validFromMs, Date.parse(relation.validity.validFrom))
  const validToMs = earlierEnd(
    eventInterval.validToMs,
    relation.validity.validTo === null ? null : Date.parse(relation.validity.validTo),
  )
  return validToMs !== null && validToMs <= validFromMs ? null : { validFromMs, validToMs }
}

export const tombstonesFor = (request: ForgetRequest): readonly GraphTombstone[] => {
  if (request.kind === 'scope') {
    return [{ kind: 'scope', scope: request.scope, targetId: null, completedAt: request.completedAt }]
  }
  if (request.kind === 'subject') {
    return [
      {
        kind: 'subject',
        scope: request.scope,
        targetId: request.subjectId,
        completedAt: request.completedAt,
      },
    ]
  }
  return request.evidenceIds.map((targetId) => ({
    kind: 'evidence' as const,
    scope: request.scope,
    targetId,
    completedAt: request.completedAt,
  }))
}

export const graphTombstoneBlocks = (event: MemoryEvent, tombstone: GraphTombstone): boolean =>
  sameScope(event.scope, tombstone.scope) &&
  (tombstone.kind === 'scope' ||
    (tombstone.kind === 'evidence' && event.evidenceId === tombstone.targetId) ||
    (tombstone.kind === 'subject' && event.entities.some(({ entityId }) => entityId === tombstone.targetId)))
