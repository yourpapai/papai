// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { makeFeatureEvents, makeGuestEvents, makeSystemEvents } from './fixture-adoption-events.js'
import {
  FIXTURE_ACTOR_COUNT,
  FIXTURE_BASE_TIME_MS,
  FIXTURE_DAY_COUNT,
  FIXTURE_SEED,
  INTENT_V1_LABELS,
  PLATFORMS,
  type AnalyticsEvent,
  type AnalyticsEventName,
  type EventProps,
  type InvocationMode,
  type TaskProvider,
} from './fixture-contract.js'
import { actorKey, atIndex, dayTime, makeActorEvent, sessionKey, utcDay } from './fixture-primitives.js'
import { INTENT_SPECS, requestedOutcomeFor } from './fixture-taxonomy.js'
import { makeTurn } from './fixture-turn.js'
import type { Actor, FixtureSummary } from './fixture-types.js'
import { propsJson, validateContentFreeEvents, validateStoredProps } from './fixture-validation.js'

export {
  FIXTURE_ACTOR_COUNT,
  FIXTURE_BASE_TIME_MS,
  FIXTURE_DAY_COUNT,
  FIXTURE_SEED,
  INTENT_V1_LABELS,
  PLATFORMS,
  propsJson,
  validateContentFreeEvents,
  validateStoredProps,
}
export type { AnalyticsEvent } from './fixture-contract.js'
export type { FixtureSummary } from './fixture-types.js'

const MINUTE_MS = 60_000
const SOURCE_REORDER_CHUNK_SIZE = 14

function makeActors(): readonly Actor[] {
  return Array.from({ length: FIXTURE_ACTOR_COUNT }, (_, index) => {
    const activationStep = index % 10
    return {
      index,
      actorKey: actorKey(index),
      platform: atIndex(PLATFORMS, index),
      actorRole: index % 19 === 0 ? 'admin' : 'member',
      engagementContext: Math.floor(index / 4) % 2 === 0 ? 'dm' : 'group',
      assignedProvider: atIndex(['kaneo', 'youtrack', 'other'] as const, Math.floor(index / 3)),
      cohortDay: index % 15,
      hasConfigLink: activationStep < 9,
      hasSettingsOpen: activationStep < 8,
      hasTaskAssignment: activationStep < 7,
      hasFirstMutatingSuccess: activationStep < 6,
    }
  })
}

function makeInitialTurn(actor: Actor, firstDmAt: number): readonly AnalyticsEvent[] {
  return makeTurn({
    actor,
    day: actor.cohortDay,
    slot: 0,
    baseAtMs: firstDmAt,
    contextType: 'dm',
    invocationMode: 'normal',
    intent: atIndex(INTENT_SPECS, actor.index),
    requestedOutcome: actor.index % 9 === 0 ? 'recovered' : 'success',
    taskProvider: 'none',
    allowMutatingSuccess: false,
    forceLlmSuccess: true,
  })
}

function activationFact(
  actor: Actor,
  firstDmAt: number,
  suffix: string,
  eventName: AnalyticsEventName,
  offsetMs: number,
  invocationMode: InvocationMode,
  taskProvider: TaskProvider,
  props: EventProps,
): AnalyticsEvent {
  return makeActorEvent(actor, {
    idSeed: `activation:${actor.index}:${suffix}`,
    occurredAtMs: firstDmAt + offsetMs,
    eventName,
    contextType: 'dm',
    invocationMode,
    taskProvider,
    sessionKey: sessionKey(actor, actor.cohortDay, 'dm'),
    props,
  })
}

function makeActivationFacts(actor: Actor, firstDmAt: number): readonly AnalyticsEvent[] {
  const config = actor.hasConfigLink
    ? [
        activationFact(actor, firstDmAt, 'config-link', 'config_link_issued', 5 * MINUTE_MS, 'command', 'none', {
          result: 'issued',
        }),
      ]
    : []
  const settings = actor.hasSettingsOpen
    ? [
        activationFact(actor, firstDmAt, 'settings-open', 'settings_opened', 20 * MINUTE_MS, 'settings', 'none', {
          entry: 'config_link',
          result: 'success',
        }),
      ]
    : []
  const assignment = actor.hasTaskAssignment
    ? [
        activationFact(
          actor,
          firstDmAt,
          'task-assigned',
          'task_instance_assigned',
          40 * MINUTE_MS,
          'settings',
          actor.assignedProvider,
          { change: 'first_assignment', from_provider: 'none', to_provider: actor.assignedProvider },
        ),
      ]
    : []
  return [...config, ...settings, ...assignment]
}

function makeFirstMutatingTurn(actor: Actor, firstDmAt: number): readonly AnalyticsEvent[] {
  if (actor.hasFirstMutatingSuccess) {
    return makeTurn({
      actor,
      day: actor.cohortDay,
      slot: 1,
      baseAtMs: firstDmAt + 80 * MINUTE_MS,
      contextType: 'dm',
      invocationMode: 'normal',
      intent: INTENT_SPECS[0],
      requestedOutcome: 'success',
      taskProvider: actor.assignedProvider,
      allowMutatingSuccess: true,
      forceLlmSuccess: true,
    })
  }
  return []
}

function makeActivationEvents(actor: Actor): readonly AnalyticsEvent[] {
  const firstDmAt = dayTime(actor, actor.cohortDay, 8 * 60)
  return [
    ...makeInitialTurn(actor, firstDmAt),
    ...makeActivationFacts(actor, firstDmAt),
    ...makeFirstMutatingTurn(actor, firstDmAt),
  ]
}

const returnOffsets = (actorIndex: number): readonly number[] => [
  ...(actorIndex < 90 ? [1] : []),
  ...(actorIndex < 60 ? [7] : []),
  ...(actorIndex < 30 ? [30] : []),
  2,
  ...(actorIndex % 2 === 0 ? [4] : []),
  ...(actorIndex % 3 === 0 ? [12] : []),
  ...(actorIndex % 4 === 0 ? [20] : []),
  ...(actorIndex % 5 === 0 ? [35] : []),
]

function makeReturnTurn(actor: Actor, day: number, offsetIndex: number): readonly AnalyticsEvent[] {
  const taskProvider: TaskProvider = actor.hasTaskAssignment ? actor.assignedProvider : 'none'
  return makeTurn({
    actor,
    day,
    slot: 10 + offsetIndex,
    baseAtMs: dayTime(actor, day, 11 * 60 + (offsetIndex % 5) * 25),
    contextType: actor.engagementContext,
    invocationMode: 'normal',
    intent: atIndex(INTENT_SPECS, actor.index * 3 + day + offsetIndex),
    requestedOutcome: requestedOutcomeFor(actor, day, offsetIndex),
    taskProvider,
    allowMutatingSuccess: actor.hasFirstMutatingSuccess,
  })
}

function makeFollowupTurn(actor: Actor, day: number, offset: number): readonly AnalyticsEvent[] {
  if (offset !== 2 || actor.index % 8 !== 0) return []
  const taskProvider: TaskProvider = actor.hasTaskAssignment ? actor.assignedProvider : 'none'
  return makeTurn({
    actor,
    day,
    slot: 100,
    baseAtMs: dayTime(actor, day, 14 * 60),
    contextType: actor.engagementContext,
    invocationMode: 'normal',
    intent: atIndex(INTENT_SPECS, actor.index + 17),
    requestedOutcome: actor.index % 16 === 0 ? 'abandoned' : 'recovered',
    taskProvider,
    allowMutatingSuccess: actor.hasFirstMutatingSuccess,
    followup: true,
  })
}

function makeReturnEvents(actor: Actor): readonly AnalyticsEvent[] {
  return returnOffsets(actor.index).flatMap((offset, index) => {
    const day = actor.cohortDay + offset
    return [...makeReturnTurn(actor, day, index), ...makeFollowupTurn(actor, day, offset)]
  })
}

export function generateFixtureEvents(): readonly AnalyticsEvent[] {
  const actorEvents = makeActors().flatMap((actor) => [
    ...makeActivationEvents(actor),
    ...makeReturnEvents(actor),
    ...makeFeatureEvents(actor),
  ])
  return [...actorEvents, ...makeGuestEvents(), ...makeSystemEvents()]
}

export function toSourceOrder(events: readonly AnalyticsEvent[]): readonly AnalyticsEvent[] {
  const chronological = [...events].toSorted(
    (left, right) => left.occurredAtMs - right.occurredAtMs || left.eventId.localeCompare(right.eventId),
  )
  return chronological.flatMap((event, index) => {
    const position = index % SOURCE_REORDER_CHUNK_SIZE
    const next = chronological[index + 1]
    if (position === 0 && next !== undefined) return [next, event]
    return position === 1 ? [] : [event]
  })
}

export function summarizeFixture(
  events: readonly AnalyticsEvent[],
  duplicateAttempts: number,
  duplicateRowsIgnored: number,
): FixtureSummary {
  const outOfOrderRows = events.reduce(
    (count, event, index) =>
      index > 0 && (events[index - 1]?.occurredAtMs ?? event.occurredAtMs) > event.occurredAtMs ? count + 1 : count,
    0,
  )
  const occurred = events.map(({ occurredAtMs }) => occurredAtMs)
  const actors = events.flatMap(({ actorKey: key }) => (key === null ? [] : [key]))
  return {
    seed: FIXTURE_SEED,
    eventCount: events.length,
    actorCount: new Set(actors).size,
    activeDateCount: new Set(occurred.map(utcDay)).size,
    duplicateAttempts,
    duplicateRowsIgnored,
    outOfOrderRows,
    outOfOrderRatio: outOfOrderRows / events.length,
    firstOccurredAtMs: Math.min(...occurred),
    lastOccurredAtMs: Math.max(...occurred),
  }
}
