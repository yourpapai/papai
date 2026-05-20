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

export type ToolCallRow = {
  eventId: string
  turnId: string
  occurredAt: number
  storageContextId: string
  contextType: ContextType
  chatUserId: string
  model: string
  modelRole: 'main' | 'small'
  toolName: string
  toolCallId: string
  success: boolean
  durationMs: number | null
  errorType: string | null
  errorCode: string | null
  retryable: boolean | null
  recovered: boolean | null
  argsBytes: number | null
  resultBytes: number | null
  responseId: string | null
}

export type ToolCallSubjectSummary = {
  storageContextId: string
  contextType: ContextType
  totalCalls: number
  successCalls: number
  failureCalls: number
  argsBytesTotal: number
  resultBytesTotal: number
  durationMsTotal: number
}
