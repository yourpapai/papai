// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHash } from 'node:crypto'

import {
  FIXTURE_BASE_TIME_MS,
  FIXTURE_SEED,
  type AnalyticsEvent,
  type AnalyticsEventName,
  type ContextType,
  type EventProps,
  type Platform,
} from './fixture-contract.js'
import type { Actor, ActorEventInput, ToolSpec, TurnInput } from './fixture-types.js'

const DAY_MS = 86_400_000
const MINUTE_MS = 60_000
const RETENTION_MS = 90 * DAY_MS
const APP_VERSION_A = '6.10.0-poc-a'
const APP_VERSION_B = '6.10.0-poc-b'

type EventInput = Omit<
  AnalyticsEvent,
  | 'eventId'
  | 'schemaName'
  | 'schemaVersion'
  | 'eventVersion'
  | 'ingestedAtMs'
  | 'eventSource'
  | 'attributionQuality'
  | 'appVersion'
  | 'deploymentKey'
  | 'keyVersion'
  | 'governancePurpose'
  | 'policyVersion'
  | 'expiresAtMs'
  | 'props'
> &
  Readonly<{ idSeed: string; props: EventProps }>

const hashHex = (value: string): string => createHash('sha256').update(value).digest('hex')

export const syntheticKey = (domain: string, value: string): string =>
  `syn_${hashHex(`${FIXTURE_SEED}:${domain}:${value}`).slice(0, 32)}`

export function atIndex<const Values extends readonly [unknown, ...unknown[]]>(
  values: Values,
  index: number,
): Values[number] {
  return values[index % values.length] ?? values[0]
}

export const utcDay = (timestampMs: number): string => new Date(timestampMs).toISOString().slice(0, 10)
export const actorKey = (index: number): string => syntheticKey('actor', String(index))
export const taskInstanceKey = (actor: Actor): string => syntheticKey('task-instance', String(actor.index))
export const turnKey = (actor: Actor, day: number, slot: number): string =>
  syntheticKey('turn', `${actor.index}:${day}:${slot}`)
export const sessionKey = (actor: Actor, day: number, contextType: ContextType): string =>
  syntheticKey('session', `${actor.index}:${day}:${contextType}`)
export const attemptKey = (turn: string): string => syntheticKey('llm-attempt', turn)
export const modelKey = (platform: Platform): string => syntheticKey('model', `main:${platform}`)
export const toolKey = (tool: ToolSpec): string | null =>
  tool.origin === 'core' ? null : syntheticKey('tool', `${tool.origin}:${tool.slug}`)

export const dayTime = (actor: Actor, day: number, minute: number, offsetMs = 0): number =>
  FIXTURE_BASE_TIME_MS + day * DAY_MS + minute * MINUTE_MS + actor.index * 1_000 + offsetMs

const platformInstanceKey = (platform: Platform): string => syntheticKey('platform-instance', platform)
const deploymentKey = (): string => syntheticKey('deployment', 'fixture')
const appVersionAt = (occurredAtMs: number): string =>
  occurredAtMs < FIXTURE_BASE_TIME_MS + 25 * DAY_MS ? APP_VERSION_A : APP_VERSION_B

const contextKey = (actor: Actor, contextType: Exclude<ContextType, 'none'>): string =>
  contextType === 'dm'
    ? syntheticKey('context', `dm:${actor.index}`)
    : syntheticKey('context', `group:${Math.floor(actor.index / 5)}`)

const threadKey = (actor: Actor, contextType: Exclude<ContextType, 'none'>): string =>
  contextType === 'dm'
    ? syntheticKey('thread', `dm:${actor.index}`)
    : syntheticKey('thread', `group:${Math.floor(actor.index / 5)}:${actor.index % 3}`)

const stableProps = (props: EventProps): EventProps =>
  Object.fromEntries([...Object.entries(props)].toSorted(([left], [right]) => left.localeCompare(right)))

function eventProvenance(idSeed: string): Readonly<{
  eventSource: 'live' | 'backfill'
  attributionQuality: 'native' | 'backfill_snapshot' | 'unknown'
  delayMs: number
}> {
  const fingerprint = hashHex(`${FIXTURE_SEED}:${idSeed}`)
  const backfill = Number.parseInt(fingerprint.slice(0, 2), 16) % 43 === 0
  const unknown = Number.parseInt(fingerprint.slice(2, 4), 16) % 97 === 0
  return {
    eventSource: backfill ? 'backfill' : 'live',
    attributionQuality: unknown ? 'unknown' : backfill ? 'backfill_snapshot' : 'native',
    delayMs: backfill ? DAY_MS + 1_000 : 500,
  }
}

export function makeEvent(input: EventInput): AnalyticsEvent {
  const { idSeed, props: originalProps, ...eventInput } = input
  const props = stableProps(originalProps)
  const provenance = eventProvenance(idSeed)
  const eventId = hashHex(
    JSON.stringify([
      FIXTURE_SEED,
      idSeed,
      eventInput.occurredAtMs,
      eventInput.eventName,
      eventInput.actorKey,
      eventInput.turnKey,
      props,
    ]),
  )
  return {
    ...eventInput,
    eventId,
    schemaName: 'papai.analytics.event',
    schemaVersion: 1,
    eventVersion: 1,
    ingestedAtMs: eventInput.occurredAtMs + provenance.delayMs,
    eventSource: provenance.eventSource,
    attributionQuality: provenance.attributionQuality,
    appVersion: appVersionAt(eventInput.occurredAtMs),
    deploymentKey: deploymentKey(),
    keyVersion: 1,
    governancePurpose: 'product_analytics',
    policyVersion: 1,
    expiresAtMs: eventInput.occurredAtMs + RETENTION_MS,
    props,
  }
}

export function makeActorEvent(actor: Actor, input: ActorEventInput): AnalyticsEvent {
  return makeEvent({
    ...input,
    platform: actor.platform,
    platformInstanceKey: platformInstanceKey(actor.platform),
    actorKey: actor.actorKey,
    contextKey: contextKey(actor, input.contextType),
    threadKey: threadKey(actor, input.contextType),
    taskInstanceKey: input.taskProvider === 'none' ? null : taskInstanceKey(actor),
    actorRole: actor.actorRole,
    collectionTier: 'pseudonymous',
    eligibility: actor.actorRole === 'admin' ? 'operator_basis' : 'allowed',
    privacyMaxClass: input.eventName === 'intent_classified' ? 'C2' : 'C1',
    turnKey: input.turnKey ?? null,
    sessionKey: input.sessionKey ?? null,
  })
}

export function makeTurnEvent(
  input: TurnInput,
  turn: string,
  session: string,
  suffix: string,
  eventName: AnalyticsEventName,
  offsetMs: number,
  props: EventProps,
): AnalyticsEvent {
  return makeActorEvent(input.actor, {
    idSeed: `turn:${input.actor.index}:${input.day}:${input.slot}:${suffix}`,
    occurredAtMs: input.baseAtMs + offsetMs,
    eventName,
    contextType: input.contextType,
    invocationMode: input.invocationMode,
    taskProvider: input.taskProvider,
    turnKey: turn,
    sessionKey: session,
    props,
  })
}
