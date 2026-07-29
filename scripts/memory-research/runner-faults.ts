// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { MemoryEventSchema } from './types.js'
import type { ForgetRequest, MemoryEvent, MemoryScenario, MemoryScope } from './types.js'

const sameScope = (left: MemoryScope, right: MemoryScope): boolean => left.kind === right.kind && left.id === right.id

export const forgetCoversEvent = (request: ForgetRequest, event: MemoryEvent): boolean => {
  if (!sameScope(request.scope, event.scope)) return false
  if (request.kind === 'scope') return true
  if (request.kind === 'evidence') return request.evidenceIds.includes(event.evidenceId)
  return event.entities.some(({ entityId }) => entityId === request.subjectId)
}

export const eventWithEmbeddingVersion = (event: MemoryEvent, version: string | null, changedAt: string): MemoryEvent =>
  MemoryEventSchema.parse({
    ...event,
    ingestTime: changedAt,
    embedding: { available: version !== null, version },
  })

export const orderedForgetRequests = (scenario: MemoryScenario): readonly ForgetRequest[] =>
  [...scenario.forgetRequests].sort(
    (left, right) => left.completedAt.localeCompare(right.completedAt) || left.kind.localeCompare(right.kind),
  )
