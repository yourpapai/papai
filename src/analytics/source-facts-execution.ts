// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { FactBase } from './source-facts.js'

export type LlmStartedFact = FactBase &
  Readonly<{
    type: 'llm_started'
    rawAttemptId: string
    modelId: string
    providerBinding: string
    modelRole: string
    phase: string
    messageCount: number
    availableToolCount: number
  }>

export type LlmCompletedFact = FactBase &
  Readonly<{
    type: 'llm_completed'
    rawAttemptId: string
    modelId: string
    providerBinding: string
    modelRole: string
    durationMs: number
    timeToFirstTokenMs: number | null
    inputTokens: number | null
    outputTokens: number | null
    stepCount: number
    finishReason: string
  }>

export type LlmFailedFact = FactBase &
  Readonly<{
    type: 'llm_failed'
    rawAttemptId: string
    modelId: string
    providerBinding: string
    modelRole: string
    phase: string
    errorClass: string
    retryable: boolean | null
    durationMs: number
  }>

export type ToolStartedFact = FactBase &
  Readonly<{
    type: 'tool_started'
    toolSlug: string
    toolOrigin: string
    toolDomain: string
    risk: string
    modelRole: string
    argsBytes: number
    toolNameKey: string | null
  }>

export type ToolCompletedFact = FactBase &
  Readonly<{
    type: 'tool_completed'
    toolSlug: string
    toolOrigin: string
    toolDomain: string
    risk: string
    modelRole: string
    argsBytes: number
    durationMs: number
    executionOutcome: string
    resultBytes: number
    errorClass: string | null
    statusClass: string
    retryable: boolean | null
    recoveredSameTurn: boolean
    toolNameKey: string | null
  }>

export type ConfirmationRequestedFact = FactBase &
  Readonly<{
    type: 'confirmation_requested'
    toolSlug: string
    toolOrigin: string
    risk: string
    timeoutMs: number
    toolNameKey: string | null
  }>

export type ConfirmationResolvedFact = FactBase &
  Readonly<{
    type: 'confirmation_resolved'
    toolSlug: string
    toolOrigin: string
    decision: string
    decisionLatencyMs: number
    toolNameKey: string | null
  }>
