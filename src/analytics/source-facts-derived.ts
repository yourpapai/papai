// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { FactBase } from './source-facts.js'

export type FeatureOpportunityFact = FactBase &
  Readonly<{
    type: 'feature_opportunity'
    feature: string
    available: boolean
    reason: string
    sampling: string
  }>

export type FeatureUsedFact = FactBase &
  Readonly<{
    type: 'feature_used'
    feature: string
    operation: string
    outcome: string
    codingProjectRawId: string | null
    codingSessionRawId: string | null
  }>

export type FirstVisibleFeedbackFact = FactBase &
  Readonly<{
    type: 'first_visible_feedback'
    kind: string
    outcome: string
    capabilitySupported: boolean
    settingEnabled: boolean
    latencyMs: number | null
  }>

export type LiveStatusOpportunityFact = FactBase &
  Readonly<{
    type: 'live_status_opportunity'
    eligible: boolean
    reason: string
  }>

export type LiveStatusLifecycleFact = FactBase &
  Readonly<{
    type: 'live_status_lifecycle'
    stage: string
    outcome: string
    latencyFromTurnStartMs: number
    ordinal: number
  }>

export type ProviderRequestCompletedFact = FactBase &
  Readonly<{
    type: 'provider_request_completed'
    provider: string
    operation: string
    durationMs: number
    outcome: string
    statusClass: string
    retryable: boolean | null
  }>

export type RateLimitBlockedFact = FactBase &
  Readonly<{
    type: 'rate_limit_blocked'
    limit: string
  }>

export type UnconfiguredReplyFact = FactBase &
  Readonly<{
    type: 'unconfigured_reply'
    missing: string
    surface: string
  }>

export type McpAvailabilityFact = FactBase &
  Readonly<{
    type: 'mcp_availability'
    origin: string
    serverRawId: string
    outcome: string
  }>

export type GuestTurnAggregateFact = FactBase &
  Readonly<{
    type: 'guest_turn_aggregate'
    utcDay: string
    turns: number
    successfulTurns: number
    failedTurns: number
    contextCount: number
  }>
