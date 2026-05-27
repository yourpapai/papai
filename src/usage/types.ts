// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type ModelRole = 'main' | 'small' | 'embedding'

export type ContextType = 'dm' | 'group'

export type UsageWindow = { windowMs: number | null }

export type SubjectRoleTotals = {
  inputTokens: number
  outputTokens: number
  calls: number
}

export type SubjectSummary = {
  storageContextId: string
  contextType: ContextType
  totals: {
    main: SubjectRoleTotals
    small: SubjectRoleTotals
    embedding: SubjectRoleTotals
  }
  toolCalls: number
  lastActiveAt: number
}

export type RequestRow = {
  eventId: string
  occurredAt: number
  turnId: string | null
  chatUserId: string
  model: string
  modelRole: ModelRole
  inputTokens: number | null
  outputTokens: number | null
  stepCount: number
  toolCallCount: number
  messageCount: number
  durationMs: number
  finishReason: string | null
  error: string | null
}
