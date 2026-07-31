// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { AnalyticsEvent } from './fixture-contract.js'
import { atIndex, makeTurnEvent, syntheticKey } from './fixture-primitives.js'
import { FEATURES } from './fixture-taxonomy.js'
import type { TurnInput } from './fixture-types.js'

interface AvailabilityState {
  readonly capabilitySupported: boolean
  readonly settingEnabled: boolean
  readonly liveEligible: boolean
  readonly feedbackSucceeded: boolean
}

const availabilityState = (input: TurnInput, durationMs: number, key: number): AvailabilityState => {
  const capabilitySupported = input.actor.platform !== 'kontur-talk'
  const settingEnabled = key % 5 !== 0
  return {
    capabilitySupported,
    settingEnabled,
    liveEligible: capabilitySupported && settingEnabled && durationMs >= 1_000,
    feedbackSucceeded: capabilitySupported && key % 13 !== 0,
  }
}

function makeFeatureOpportunity(input: TurnInput, turn: string, session: string, key: number): AnalyticsEvent {
  const available = key % 7 !== 0
  return makeTurnEvent(input, turn, session, 'feature-opportunity', 'feature_opportunity', 120, {
    feature: atIndex(FEATURES, key),
    available,
    reason: available ? 'available' : key % 2 === 0 ? 'capability_missing' : 'provider_missing',
    sampling: 'first_eligible_actor_day',
  })
}

function makeFeedback(input: TurnInput, turn: string, session: string, state: AvailabilityState): AnalyticsEvent {
  const kind = state.feedbackSucceeded ? (state.liveEligible ? 'live_status' : 'typing') : 'none'
  const outcome = state.feedbackSucceeded ? 'success' : state.capabilitySupported ? 'missing' : 'not_applicable'
  return makeTurnEvent(input, turn, session, 'first-visible-feedback', 'first_visible_feedback', 130, {
    kind,
    outcome,
    capability_supported: state.capabilitySupported,
    setting_enabled: state.settingEnabled,
    latency_ms: state.feedbackSucceeded ? 130 : null,
  })
}

function liveStatusReason(state: AvailabilityState): string {
  if (state.liveEligible) return 'eligible'
  if (state.capabilitySupported) return state.settingEnabled ? 'turn_too_short' : 'disabled'
  return 'platform_unsupported'
}

function makeLiveOpportunity(
  input: TurnInput,
  turn: string,
  session: string,
  state: AvailabilityState,
): AnalyticsEvent {
  return makeTurnEvent(input, turn, session, 'live-status-opportunity', 'live_status_opportunity', 140, {
    eligible: state.liveEligible,
    reason: liveStatusReason(state),
  })
}

function makeLiveLifecycle(
  input: TurnInput,
  turn: string,
  session: string,
  state: AvailabilityState,
  durationMs: number,
  key: number,
): readonly AnalyticsEvent[] {
  if (state.liveEligible) {
    const updateAt = Math.min(5_000, durationMs - 250)
    return [
      makeTurnEvent(input, turn, session, 'live-status-create', 'live_status_lifecycle', 1_000, {
        stage: 'create',
        outcome: key % 17 === 0 ? 'failed' : 'success',
        latency_from_turn_start_ms: 1_000,
        ordinal: 1,
      }),
      makeTurnEvent(input, turn, session, 'live-status-update', 'live_status_lifecycle', updateAt, {
        stage: 'update',
        outcome: 'success',
        latency_from_turn_start_ms: updateAt,
        ordinal: 2,
      }),
      makeTurnEvent(input, turn, session, 'live-status-dismiss', 'live_status_lifecycle', durationMs - 100, {
        stage: 'dismiss',
        outcome: 'success',
        latency_from_turn_start_ms: durationMs - 100,
        ordinal: 3,
      }),
    ]
  }
  return []
}

function makeMcpAvailability(input: TurnInput, turn: string, session: string, key: number): readonly AnalyticsEvent[] {
  if (key % 31 !== 0) return []
  const connectionFailed = key % 62 === 0
  return [
    makeTurnEvent(input, turn, session, 'mcp-availability', 'mcp_availability', 160, {
      origin: connectionFailed ? 'user_endpoint' : 'plugin_endpoint',
      server_key: syntheticKey('mcp-server', String(key % 5)),
      outcome: connectionFailed ? 'connection_failed' : 'available',
    }),
  ]
}

export function makeAvailabilityEvents(
  input: TurnInput,
  turn: string,
  session: string,
  durationMs: number,
  key: number,
): readonly AnalyticsEvent[] {
  const state = availabilityState(input, durationMs, key)
  return [
    makeFeatureOpportunity(input, turn, session, key),
    makeFeedback(input, turn, session, state),
    makeLiveOpportunity(input, turn, session, state),
    ...makeLiveLifecycle(input, turn, session, state, durationMs, key),
    ...makeMcpAvailability(input, turn, session, key),
  ]
}
