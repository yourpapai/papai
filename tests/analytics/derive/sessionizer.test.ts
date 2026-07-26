// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { SessionSourceEvent } from '../../../src/analytics/derive/sessionizer.js'
import {
  conversationKeyOf,
  partitionSessionEvents,
  SESSION_GAP_MS,
  sessionizePartition,
} from '../../../src/analytics/derive/sessionizer.js'

const KEY_INPUT = { key: Buffer.alloc(32, 9), keyVersion: 'v1' } as const

const ACTOR_A = 'v1.p-actor-a'
const ACTOR_B = 'v1.p-actor-b'
const CONV = 'v1.p-conv-1'

const MIN = 60_000

const event = (
  overrides: Partial<SessionSourceEvent> & Pick<SessionSourceEvent, 'eventId' | 'occurredAtMs'>,
): SessionSourceEvent => ({
  eventName: 'chat_message_accepted',
  actorKey: ACTOR_A,
  contextKey: CONV,
  threadKey: null,
  turnKey: null,
  actorRole: 'member',
  invocationMode: 'normal',
  ...overrides,
})

const activity = (eventId: string, occurredAtMs: number, overrides?: Partial<SessionSourceEvent>): SessionSourceEvent =>
  event({ eventId, occurredAtMs, ...overrides })

const turnActivity = (eventId: string, occurredAtMs: number, turnKey: string): SessionSourceEvent =>
  event({ eventId, occurredAtMs, eventName: 'turn_started', turnKey })

const child = (eventId: string, occurredAtMs: number, turnKey: string, eventName = 'reply_sent'): SessionSourceEvent =>
  event({ eventId, occurredAtMs, eventName, turnKey })

const sessionize = (
  events: readonly SessionSourceEvent[],
  actorKey = ACTOR_A,
  conversationKey = CONV,
): ReturnType<typeof sessionizePartition> => sessionizePartition({ actorKey, conversationKey, events }, KEY_INPUT)

describe('sessionizer gap boundaries (sessionization v1)', () => {
  test('a 29:59 gap keeps the session', () => {
    const sessions = sessionize([activity('e1', 0), activity('e2', 29 * MIN + 59_000)])
    expect(SESSION_GAP_MS).toBe(1_800_000)
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.activityCount).toBe(2)
  })

  test('an exactly 30:00 gap keeps the session', () => {
    const sessions = sessionize([activity('e1', 0), activity('e2', 30 * MIN)])
    expect(sessions).toHaveLength(1)
  })

  test('a 30:00.001 gap opens a new session', () => {
    const sessions = sessionize([activity('e1', 0), activity('e2', 30 * MIN + 1)])
    expect(sessions).toHaveLength(2)
    expect(sessions[0]?.sessionKey).not.toBe(sessions[1]?.sessionKey)
    expect(sessions[1]?.startMs).toBe(30 * MIN + 1)
  })

  test('session key derives from actor, conversation, start time, and first event', () => {
    const first = sessionize([activity('e1', 0)])
    const sameInputs = sessionize([activity('e1', 0)])
    const otherStart = sessionize([activity('e1', 5)])
    const otherFirst = sessionize([activity('e9', 0)])
    expect(first[0]?.sessionKey).toBe(sameInputs[0]?.sessionKey)
    expect(first[0]?.sessionKey).not.toBe(otherStart[0]?.sessionKey)
    expect(first[0]?.sessionKey).not.toBe(otherFirst[0]?.sessionKey)
    expect(first[0]?.startMs).toBe(0)
    expect(first[0]?.firstEventId).toBe('e1')
  })
})

describe('sessionizer ordering and partitions', () => {
  test('out-of-order input is ordered by (occurred_at_ms, event_id)', () => {
    const sessions = sessionize([activity('e3', 2_000), activity('e1', 0), activity('e2', 1_000)])
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.events.map((entry) => entry.eventId)).toEqual(['e1', 'e2', 'e3'])
  })

  test('same-timestamp ties break by event id', () => {
    const sessions = sessionize([activity('b2', 0), activity('a1', 0)])
    expect(sessions[0]?.firstEventId).toBe('a1')
  })

  test('a session can span midnight UTC', () => {
    const beforeMidnight = Date.UTC(2026, 6, 26, 23, 45, 0)
    const afterMidnight = Date.UTC(2026, 6, 27, 0, 10, 0)
    const sessions = sessionize([activity('e1', beforeMidnight), activity('e2', afterMidnight)])
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.endMs).toBe(afterMidnight)
  })

  test('two actors in one thread are partitioned separately', () => {
    const partitions = partitionSessionEvents([
      activity('e1', 0, { actorKey: ACTOR_A, threadKey: 'v1.p-thread-1', contextKey: CONV }),
      activity('e2', 1_000, { actorKey: ACTOR_B, threadKey: 'v1.p-thread-1', contextKey: CONV }),
    ])
    expect(partitions).toHaveLength(2)
    const keys = partitions.map((partition) => `${partition.actorKey}|${partition.conversationKey}`)
    expect(keys).toContain(`${ACTOR_A}|v1.p-thread-1`)
    expect(keys).toContain(`${ACTOR_B}|v1.p-thread-1`)
  })

  test('sibling threads of one context are not merged', () => {
    const partitions = partitionSessionEvents([
      activity('e1', 0, { threadKey: 'v1.p-thread-a', contextKey: CONV }),
      activity('e2', 1_000, { threadKey: 'v1.p-thread-b', contextKey: CONV }),
    ])
    expect(partitions).toHaveLength(2)
  })

  test('conversation_key is thread_key ?? context_key', () => {
    expect(
      conversationKeyOf(event({ eventId: 'e1', occurredAtMs: 0, threadKey: 'v1.p-t', contextKey: 'v1.p-c' })),
    ).toBe('v1.p-t')
    expect(conversationKeyOf(event({ eventId: 'e1', occurredAtMs: 0, threadKey: null, contextKey: 'v1.p-c' }))).toBe(
      'v1.p-c',
    )
    expect(conversationKeyOf(event({ eventId: 'e1', occurredAtMs: 0, threadKey: null, contextKey: null }))).toBeNull()
  })

  test('one Discord actor in two distinct DMs never shares a session', () => {
    const dmOne = activity('e1', 0, { threadKey: null, contextKey: 'v1.p-discord-dm-1' })
    const dmTwo = activity('e2', 1_000, { threadKey: null, contextKey: 'v1.p-discord-dm-2' })
    expect(dmOne.threadKey).toBeNull()
    expect(dmTwo.threadKey).toBeNull()
    expect(conversationKeyOf(dmOne)).not.toBe(conversationKeyOf(dmTwo))
    const partitions = partitionSessionEvents([dmOne, dmTwo])
    expect(partitions).toHaveLength(2)
    const sessions = partitions.flatMap((partition) => sessionizePartition(partition, KEY_INPUT))
    expect(sessions).toHaveLength(2)
    expect(sessions[0]?.sessionKey).not.toBe(sessions[1]?.sessionKey)
  })

  test('guests produce no sessions', () => {
    const partitions = partitionSessionEvents([activity('e1', 0, { actorRole: 'guest' })])
    expect(partitions).toHaveLength(0)
  })

  test('events without an actor or conversation key produce no sessions', () => {
    const partitions = partitionSessionEvents([
      activity('e1', 0, { actorKey: null }),
      activity('e2', 1_000, { contextKey: null, threadKey: null }),
    ])
    expect(partitions).toHaveLength(0)
  })
})

describe('sessionizer activity semantics', () => {
  test('a single-event session has zero duration', () => {
    const sessions = sessionize([activity('e1', 123_000)])
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.startMs).toBe(123_000)
    expect(sessions[0]?.endMs).toBe(123_000)
    expect(sessions[0]?.durationMs).toBe(0)
  })

  test('commands are accepted activity', () => {
    const sessions = sessionize([
      activity('e1', 0),
      activity('e2', 20 * MIN, { invocationMode: 'command' }),
      activity('e3', 40 * MIN),
    ])
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.activityCount).toBe(3)
  })

  test('proactive and scheduler events do not open or extend sessions', () => {
    const sessions = sessionize([
      activity('e1', 0),
      activity('e2', 20 * MIN, { invocationMode: 'proactive' }),
      activity('e3', 61 * MIN),
    ])
    expect(sessions).toHaveLength(2)
    expect(sessions[0]?.events.map((entry) => entry.eventId)).toEqual(['e1'])
    expect(sessions[1]?.events.map((entry) => entry.eventId)).toEqual(['e3'])
  })

  test('bot-only replies never open a session', () => {
    const sessions = sessionize([child('r1', 1_000, 'v1.p-turn-unknown')])
    expect(sessions).toHaveLength(0)
  })

  test('permission decisions extend sessions', () => {
    const sessions = sessionize([
      turnActivity('t1', 0, 'v1.p-turn-1'),
      event({ eventId: 'c1', occurredAtMs: 25 * MIN, eventName: 'confirmation_resolved', turnKey: 'v1.p-turn-1' }),
      activity('e2', 50 * MIN),
    ])
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.events.find((entry) => entry.eventId === 'c1')?.extendsSession).toBe(true)
  })

  test('child LLM/tool/reply facts inherit the turn session and do not extend it', () => {
    const sessions = sessionize([
      turnActivity('t1', 0, 'v1.p-turn-1'),
      child('l1', 1_000, 'v1.p-turn-1', 'llm_started'),
      child('x1', 2_000, 'v1.p-turn-1', 'tool_completed'),
      child('r1', 31 * MIN, 'v1.p-turn-1'),
      activity('e2', 61 * MIN),
    ])
    expect(sessions).toHaveLength(2)
    const first = sessions[0]
    expect(first?.events.map((entry) => entry.eventId)).toEqual(['t1', 'l1', 'x1', 'r1'])
    expect(first?.events.find((entry) => entry.eventId === 'r1')?.extendsSession).toBe(false)
    expect(first?.endMs).toBe(31 * MIN)
    expect(first?.turnCount).toBe(1)
    const second = sessions[1]
    expect(second?.events.map((entry) => entry.eventId)).toEqual(['e2'])
    expect(second?.durationMs).toBe(0)
  })

  test('turn completion later than the last activity sets the session end', () => {
    const sessions = sessionize([
      turnActivity('t1', 0, 'v1.p-turn-1'),
      child('tc1', 5 * MIN, 'v1.p-turn-1', 'turn_completed'),
    ])
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.endMs).toBe(5 * MIN)
    expect(sessions[0]?.durationMs).toBe(5 * MIN)
  })
})
