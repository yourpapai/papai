// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import {
  FIXTURE_BASE_TIME_MS,
  FIXTURE_DAY_COUNT,
  PLATFORMS,
  type AnalyticsEvent,
  type TaskProvider,
} from './fixture-contract.js'
import { atIndex, dayTime, makeActorEvent, makeEvent, sessionKey, syntheticKey, utcDay } from './fixture-primitives.js'
import { FEATURES } from './fixture-taxonomy.js'
import type { Actor } from './fixture-types.js'

const DAY_MS = 86_400_000
const MINUTE_MS = 60_000

export function makeFeatureEvents(actor: Actor): readonly AnalyticsEvent[] {
  if (actor.index % 4 === 3) return []
  const feature = atIndex(FEATURES, actor.index)
  const day = actor.cohortDay + 3
  const usedAtMs = dayTime(actor, day, 16 * 60)
  const taskProvider: TaskProvider = actor.hasTaskAssignment ? actor.assignedProvider : 'none'
  const shared = {
    contextType: actor.engagementContext,
    invocationMode: 'normal' as const,
    taskProvider,
    sessionKey: sessionKey(actor, day, actor.engagementContext),
  }
  const coding = feature === 'coding'
  return [
    makeActorEvent(actor, {
      ...shared,
      idSeed: `feature:${actor.index}:${feature}:opportunity`,
      occurredAtMs: usedAtMs - 1_000,
      eventName: 'feature_opportunity',
      props: { feature, available: true, reason: 'available', sampling: 'first_eligible_actor_day' },
    }),
    makeActorEvent(actor, {
      ...shared,
      idSeed: `feature:${actor.index}:${feature}:used`,
      occurredAtMs: usedAtMs,
      eventName: 'feature_used',
      props: {
        feature,
        operation:
          feature === 'coding' ? 'start' : feature === 'byok' || feature === 'guest_mode' ? 'enable' : 'create',
        outcome: 'success',
        coding_project_key: coding ? syntheticKey('coding-project', String(actor.index)) : null,
        coding_session_key: coding ? syntheticKey('coding-session', String(actor.index)) : null,
      },
    }),
  ]
}

export function makeGuestEvents(): readonly AnalyticsEvent[] {
  return Array.from({ length: FIXTURE_DAY_COUNT }, (_, day) =>
    PLATFORMS.map((platform, platformIndex) =>
      makeEvent({
        idSeed: `guest:${day}:${platform}`,
        occurredAtMs: FIXTURE_BASE_TIME_MS + day * DAY_MS + (18 * 60 + platformIndex * 5) * MINUTE_MS,
        eventName: 'guest_turn_aggregate',
        platform,
        platformInstanceKey: syntheticKey('platform-instance', platform),
        actorKey: null,
        contextKey: null,
        threadKey: null,
        taskInstanceKey: null,
        contextType: 'none',
        actorRole: 'guest',
        taskProvider: 'none',
        invocationMode: 'normal',
        turnKey: null,
        sessionKey: null,
        collectionTier: 'aggregate',
        eligibility: 'not_applicable',
        privacyMaxClass: 'C0',
        props: {
          utc_day: utcDay(FIXTURE_BASE_TIME_MS + day * DAY_MS),
          turns: 12 + platformIndex,
          successful_turns: 10 + platformIndex,
          failed_turns: 2,
          contexts: '6_10',
        },
      }),
    ),
  ).flat()
}

export function makeSystemEvents(): readonly AnalyticsEvent[] {
  const common = {
    platformInstanceKey: syntheticKey('platform-instance', 'telegram'),
    actorKey: null,
    contextKey: null,
    threadKey: null,
    taskInstanceKey: null,
    contextType: 'none' as const,
    actorRole: 'system' as const,
    turnKey: null,
    sessionKey: null,
    collectionTier: 'aggregate' as const,
    eligibility: 'not_applicable' as const,
    privacyMaxClass: 'C0' as const,
  }
  return [
    makeEvent({
      ...common,
      idSeed: 'system:proactive-provider-health',
      occurredAtMs: FIXTURE_BASE_TIME_MS + 9 * DAY_MS + 17 * 60 * MINUTE_MS,
      eventName: 'provider_request_completed',
      platform: 'telegram',
      taskProvider: 'other',
      invocationMode: 'proactive',
      props: {
        provider: 'other',
        operation: 'other',
        duration_ms: 240,
        outcome: 'success',
        status_class: '2xx',
        retryable: null,
      },
    }),
    makeEvent({
      ...common,
      idSeed: 'system:scheduled-mcp-health',
      occurredAtMs: FIXTURE_BASE_TIME_MS + 10 * DAY_MS + 17 * 60 * MINUTE_MS,
      eventName: 'mcp_availability',
      platform: 'telegram',
      taskProvider: 'none',
      invocationMode: 'scheduler',
      props: {
        origin: 'plugin_endpoint',
        server_key: syntheticKey('mcp-server', 'scheduled-health'),
        outcome: 'available',
      },
    }),
  ]
}
