// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createPseudonym } from '../identity/pseudonym.js'

export const SESSIONIZATION_VERSION = 1
export const SESSION_GAP_MS = 1_800_000
export const SESSION_KEY_DOMAIN = 'session:v1'

const ACTIVITY_EVENT_NAMES = new Set(['chat_message_accepted', 'turn_started', 'turn_steered', 'confirmation_resolved'])

const ACTIVITY_INVOCATION_MODES = new Set(['normal', 'command'])

const CHILD_EVENT_NAMES = new Set([
  'turn_completed',
  'reply_sent',
  'llm_started',
  'llm_completed',
  'llm_failed',
  'tool_started',
  'tool_completed',
  'confirmation_requested',
  'turn_stop_requested',
  'clarification_requested',
  'clarification_abandoned',
  'rephrase_detected',
  'disclosure_fallback',
  'first_visible_feedback',
  'live_status_opportunity',
  'live_status_lifecycle',
  'intent_classified',
])

export type SessionSourceEvent = Readonly<{
  eventId: string
  eventName: string
  occurredAtMs: number
  actorKey: string | null
  contextKey: string | null
  threadKey: string | null
  turnKey: string | null
  actorRole: string
  invocationMode: string
}>

export type SessionKeyInput = Readonly<{ key: Buffer | Uint8Array; keyVersion: string }>

export type SessionPartition = Readonly<{
  actorKey: string
  conversationKey: string
  events: readonly SessionSourceEvent[]
}>

export type SessionEventAssignment = Readonly<{
  eventId: string
  occurredAtMs: number
  extendsSession: boolean
}>

export type SessionizedSession = Readonly<{
  sessionKey: string
  actorKey: string
  conversationKey: string
  startMs: number
  endMs: number
  durationMs: number
  activityCount: number
  turnCount: number
  firstEventId: string
  lastEventId: string
  events: readonly SessionEventAssignment[]
}>

export const conversationKeyOf = (event: Pick<SessionSourceEvent, 'threadKey' | 'contextKey'>): string | null =>
  event.threadKey ?? event.contextKey

export const isSessionActivity = (event: SessionSourceEvent): boolean =>
  event.actorKey !== null &&
  event.actorRole !== 'guest' &&
  ACTIVITY_EVENT_NAMES.has(event.eventName) &&
  ACTIVITY_INVOCATION_MODES.has(event.invocationMode)

export const isSessionChild = (event: SessionSourceEvent): boolean =>
  event.turnKey !== null && CHILD_EVENT_NAMES.has(event.eventName)

const byOccurrence = (left: SessionSourceEvent, right: SessionSourceEvent): number =>
  left.occurredAtMs - right.occurredAtMs || left.eventId.localeCompare(right.eventId)

export const partitionSessionEvents = (events: readonly SessionSourceEvent[]): readonly SessionPartition[] => {
  const partitions = new Map<string, { actorKey: string; conversationKey: string; events: SessionSourceEvent[] }>()
  const sorted = [...events].sort(byOccurrence)
  for (const event of sorted) {
    if (event.actorKey === null || event.actorRole === 'guest') continue
    const conversationKey = conversationKeyOf(event)
    if (conversationKey === null) continue
    const partitionKey = `${event.actorKey}${conversationKey}`
    const existing = partitions.get(partitionKey)
    if (existing === undefined) {
      partitions.set(partitionKey, { actorKey: event.actorKey, conversationKey, events: [event] })
    } else {
      existing.events.push(event)
    }
  }
  return [...partitions.values()]
}

type MutableSession = {
  sessionKey: string
  startMs: number
  lastActivityMs: number
  endMs: number
  activityCount: number
  turnKeys: Set<string>
  firstEventId: string
  events: SessionEventAssignment[]
}

const openSession = (
  partition: SessionPartition,
  event: SessionSourceEvent,
  keyInput: SessionKeyInput,
): MutableSession => ({
  sessionKey: createPseudonym({
    key: keyInput.key,
    keyVersion: keyInput.keyVersion,
    domain: SESSION_KEY_DOMAIN,
    components: [partition.actorKey, partition.conversationKey, String(event.occurredAtMs), event.eventId],
  }),
  startMs: event.occurredAtMs,
  lastActivityMs: event.occurredAtMs,
  endMs: event.occurredAtMs,
  activityCount: 1,
  turnKeys: new Set(event.turnKey === null ? [] : [event.turnKey]),
  firstEventId: event.eventId,
  events: [{ eventId: event.eventId, occurredAtMs: event.occurredAtMs, extendsSession: true }],
})

const extendSession = (session: MutableSession, event: SessionSourceEvent): void => {
  session.lastActivityMs = event.occurredAtMs
  session.endMs = Math.max(session.endMs, event.occurredAtMs)
  session.activityCount += 1
  if (event.turnKey !== null) session.turnKeys.add(event.turnKey)
  session.events.push({ eventId: event.eventId, occurredAtMs: event.occurredAtMs, extendsSession: true })
}

const inheritIntoSession = (session: MutableSession, event: SessionSourceEvent): void => {
  session.endMs = Math.max(session.endMs, event.occurredAtMs)
  session.events.push({ eventId: event.eventId, occurredAtMs: event.occurredAtMs, extendsSession: false })
}

const freeze = (partition: SessionPartition, session: MutableSession): SessionizedSession => ({
  sessionKey: session.sessionKey,
  actorKey: partition.actorKey,
  conversationKey: partition.conversationKey,
  startMs: session.startMs,
  endMs: session.endMs,
  durationMs: session.endMs - session.startMs,
  activityCount: session.activityCount,
  turnCount: session.turnKeys.size,
  firstEventId: session.firstEventId,
  lastEventId: session.events.reduce((latest, entry) =>
    entry.occurredAtMs > latest.occurredAtMs ||
    (entry.occurredAtMs === latest.occurredAtMs && entry.eventId > latest.eventId)
      ? entry
      : latest,
  ).eventId,
  events: session.events,
})

export const sessionizePartition = (
  partition: SessionPartition,
  keyInput: SessionKeyInput,
): readonly SessionizedSession[] => {
  const eligible = partition.events
    .filter(
      (event) =>
        event.actorKey === partition.actorKey &&
        conversationKeyOf(event) === partition.conversationKey &&
        event.actorRole !== 'guest',
    )
    .sort(byOccurrence)

  const sessions: MutableSession[] = []
  let current: MutableSession | null = null
  for (const event of eligible) {
    if (!isSessionActivity(event)) continue
    if (current === null || event.occurredAtMs - current.lastActivityMs > SESSION_GAP_MS) {
      current = openSession(partition, event, keyInput)
      sessions.push(current)
    } else {
      extendSession(current, event)
    }
  }

  const sessionByTurn = new Map<string, MutableSession>()
  for (const session of sessions) {
    for (const turnKey of session.turnKeys) {
      sessionByTurn.set(turnKey, session)
    }
  }
  for (const event of eligible) {
    if (isSessionActivity(event) || !isSessionChild(event) || event.turnKey === null) continue
    const session = sessionByTurn.get(event.turnKey)
    if (session !== undefined) inheritIntoSession(session, event)
  }

  return sessions.map((session) => freeze(partition, session))
}
