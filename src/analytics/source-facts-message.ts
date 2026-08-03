// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { FactBase } from './source-facts.js'

export type ChatMessageAcceptedFact = FactBase &
  Readonly<{
    type: 'chat_message_accepted'
    inputCount: number
    inputLengthChars: number
    attachmentCount: number
    isCommand: boolean
    command: string
  }>

export type AuthCheckedFact = FactBase &
  Readonly<{
    type: 'auth_checked'
    outcome: string
    reason: string
  }>

export type TurnStartedFact = FactBase &
  Readonly<{
    type: 'turn_started'
    incomingMessageCount: number
    attachmentCount: number
    queueWaitMs: number
  }>

export type TurnCompletedFact = FactBase &
  Readonly<{
    type: 'turn_completed'
    outcome: string
    durationMs: number
    stepCount: number
    toolCallCount: number
    replyCount: number
    finishReason: string
    clarification: boolean
    liveStatusUsed: boolean
  }>

export type ReplySentFact = FactBase &
  Readonly<{
    type: 'reply_sent'
    latencyMs: number
    partCount: number
    totalLengthChars: number
    delivery: string
  }>
