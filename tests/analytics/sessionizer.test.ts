// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { eq } from 'drizzle-orm'

import type { CollectionEligibilityRef } from '../../src/analytics/governance/eligibility.js'
import { runDeriveJob } from '../../src/analytics/jobs/derive.js'
import type { DeriveJobInput } from '../../src/analytics/jobs/derive.js'
import * as schema from '../../src/db/schema.js'
import {
  allowActor,
  DERIVE_EPOCH,
  DERIVE_KEY,
  DERIVE_KEY_VERSION,
  seedEvent,
  setupDeriveDb,
  T0,
} from './derive-fixtures.js'
import type { TestDb } from './derive-fixtures.js'

const MIN = 60_000
const NOW = T0 + 2 * 86_400_000

const jobInput = (overrides?: Partial<DeriveJobInput>): DeriveJobInput => ({
  processEpochId: DERIVE_EPOCH,
  key: DERIVE_KEY,
  keyVersion: DERIVE_KEY_VERSION,
  nowMs: NOW,
  localMode: 'local_pseudonymous',
  windowStartMs: T0 - 1,
  windowEndMs: NOW,
  ...overrides,
})

const runJob = (db: TestDb, overrides?: Partial<DeriveJobInput>): ReturnType<typeof runDeriveJob> =>
  runDeriveJob(jobInput(overrides), { getDrizzleDb: () => db })

const messageProps = (isCommand = false): Record<string, unknown> => ({
  input_count: '1',
  length_bucket: '1_32',
  attachment_count: '0',
  is_command: isCommand,
  command: isCommand ? 'config' : 'none',
})

const sessionsOf = (db: TestDb): readonly schema.AnalyticsSessionRow[] =>
  db.select().from(schema.analyticsSessions).all()

const requireRow = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error('expected a row')
  return value
}

describe('session materialization (sessionization v1)', () => {
  let db: TestDb
  let ref: CollectionEligibilityRef

  beforeEach(async () => {
    db = await setupDeriveDb()
    ref = allowActor(db, 'user-42')
  })

  test('gap fixtures: 29:59 and exactly 30:00 keep the session; 30:00.001 opens a new one', () => {
    seedEvent(db, ref, { id: 'v1.p-a1', name: 'chat_message_accepted', occurredAtMs: T0, props: messageProps() })
    seedEvent(db, ref, {
      id: 'v1.p-a2',
      name: 'chat_message_accepted',
      occurredAtMs: T0 + 29 * MIN + 59_000,
      props: messageProps(),
    })
    runJob(db)
    expect(sessionsOf(db)).toHaveLength(1)

    seedEvent(db, ref, {
      id: 'v1.p-b1',
      name: 'chat_message_accepted',
      occurredAtMs: T0 + 60 * MIN,
      actorKey: 'v1.p-actor-b',
      contextKey: 'v1.p-context-b',
      props: messageProps(),
    })
    seedEvent(db, ref, {
      id: 'v1.p-b2',
      name: 'chat_message_accepted',
      occurredAtMs: T0 + 90 * MIN,
      actorKey: 'v1.p-actor-b',
      contextKey: 'v1.p-context-b',
      props: messageProps(),
    })
    seedEvent(db, ref, {
      id: 'v1.p-c1',
      name: 'chat_message_accepted',
      occurredAtMs: T0,
      actorKey: 'v1.p-actor-c',
      contextKey: 'v1.p-context-c',
      props: messageProps(),
    })
    seedEvent(db, ref, {
      id: 'v1.p-c2',
      name: 'chat_message_accepted',
      occurredAtMs: T0 + 30 * MIN + 1,
      actorKey: 'v1.p-actor-c',
      contextKey: 'v1.p-context-c',
      props: messageProps(),
    })
    runJob(db)
    const sessions = sessionsOf(db)
    expect(sessions).toHaveLength(4)
    const byActor = (actorKey: string): readonly schema.AnalyticsSessionRow[] =>
      sessions.filter((row) => row.actorKey === actorKey)
    expect(byActor('v1.p-actor')).toHaveLength(1)
    expect(byActor('v1.p-actor-b')).toHaveLength(1)
    expect(byActor('v1.p-actor-c')).toHaveLength(2)
  })

  test('two actors in one thread get separate sessions in the same partition run', () => {
    seedEvent(db, ref, {
      id: 'v1.p-a1',
      name: 'chat_message_accepted',
      occurredAtMs: T0,
      threadKey: 'v1.p-thread',
      props: messageProps(),
    })
    seedEvent(db, ref, {
      id: 'v1.p-b1',
      name: 'chat_message_accepted',
      occurredAtMs: T0 + 1_000,
      actorKey: 'v1.p-actor-b',
      threadKey: 'v1.p-thread',
      props: messageProps(),
    })
    runJob(db)
    const sessions = sessionsOf(db)
    expect(sessions).toHaveLength(2)
    expect(new Set(sessions.map((row) => row.conversationKey))).toEqual(new Set(['v1.p-thread']))
    expect(sessions[0]?.sessionKey).not.toBe(sessions[1]?.sessionKey)
  })

  test('sibling threads of one context are not merged', () => {
    seedEvent(db, ref, {
      id: 'v1.p-a1',
      name: 'chat_message_accepted',
      occurredAtMs: T0,
      threadKey: 'v1.p-thread-a',
      props: messageProps(),
    })
    seedEvent(db, ref, {
      id: 'v1.p-a2',
      name: 'chat_message_accepted',
      occurredAtMs: T0 + 1_000,
      threadKey: 'v1.p-thread-b',
      props: messageProps(),
    })
    runJob(db)
    const sessions = sessionsOf(db)
    expect(sessions).toHaveLength(2)
    expect(new Set(sessions.map((row) => row.conversationKey))).toEqual(new Set(['v1.p-thread-a', 'v1.p-thread-b']))
  })

  test('one Discord actor across two DMs keeps thread_key null and never shares a session', () => {
    seedEvent(db, ref, {
      id: 'v1.p-d1',
      name: 'chat_message_accepted',
      occurredAtMs: T0,
      platform: 'discord',
      threadKey: null,
      contextKey: 'v1.p-discord-dm-1',
      props: messageProps(),
    })
    seedEvent(db, ref, {
      id: 'v1.p-d2',
      name: 'chat_message_accepted',
      occurredAtMs: T0 + 1_000,
      platform: 'discord',
      threadKey: null,
      contextKey: 'v1.p-discord-dm-2',
      props: messageProps(),
    })
    runJob(db)
    const rows = db.select().from(schema.analyticsEvents).all()
    expect(rows.every((row) => row.threadKey === null)).toBe(true)
    const sessions = sessionsOf(db)
    expect(sessions).toHaveLength(2)
    expect(new Set(sessions.map((row) => row.conversationKey))).toEqual(
      new Set(['v1.p-discord-dm-1', 'v1.p-discord-dm-2']),
    )
    expect(sessions[0]?.sessionKey).not.toBe(sessions[1]?.sessionKey)
  })

  test('guests produce no session rows', () => {
    seedEvent(db, ref, {
      id: 'v1.p-g1',
      name: 'chat_message_accepted',
      occurredAtMs: T0,
      actorKey: null,
      actorRole: 'guest',
      props: messageProps(),
    })
    seedEvent(db, ref, {
      id: 'v1.p-g2',
      name: 'turn_started',
      occurredAtMs: T0 + 1,
      actorKey: null,
      actorRole: 'guest',
      turnKey: 'v1.p-guest-turn',
      props: { incoming_message_count: '1', attachment_count: '0', queue_wait_ms: 0 },
    })
    const result = runJob(db)
    expect(result.partitions).toBe(0)
    expect(sessionsOf(db)).toHaveLength(0)
    expect(db.select().from(schema.analyticsSessionEvents).all()).toHaveLength(0)
  })

  test('commands extend sessions while proactive events and bot-only replies do not', () => {
    seedEvent(db, ref, { id: 'v1.p-a1', name: 'chat_message_accepted', occurredAtMs: T0, props: messageProps() })
    seedEvent(db, ref, {
      id: 'v1.p-c1',
      name: 'chat_message_accepted',
      occurredAtMs: T0 + 20 * MIN,
      invocationMode: 'command',
      props: messageProps(true),
    })
    seedEvent(db, ref, {
      id: 'v1.p-p1',
      name: 'chat_message_accepted',
      occurredAtMs: T0 + 25 * MIN,
      invocationMode: 'proactive',
      props: messageProps(),
    })
    seedEvent(db, ref, {
      id: 'v1.p-r1',
      name: 'reply_sent',
      occurredAtMs: T0 + 40 * MIN,
      turnKey: 'v1.p-unrelated-turn',
      props: { latency_ms: 5, part_count: '1', length_bucket: '1_32', delivery: 'success' },
    })
    runJob(db)
    const sessions = sessionsOf(db)
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.activityCount).toBe(2)
    const assignments = db.select().from(schema.analyticsSessionEvents).all()
    const session = requireRow(sessions[0])
    expect(new Set(assignments.map((row) => row.eventId))).toEqual(new Set([session.firstEventId, session.lastEventId]))
  })

  test('a single-event session materializes with zero duration', () => {
    seedEvent(db, ref, {
      id: 'v1.p-a1',
      name: 'chat_message_accepted',
      occurredAtMs: T0 + 5_000,
      props: messageProps(),
    })
    runJob(db)
    const session = db
      .select()
      .from(schema.analyticsSessions)
      .where(eq(schema.analyticsSessions.actorKey, 'v1.p-actor'))
      .get()
    expect(session?.startMs).toBe(T0 + 5_000)
    expect(session?.endMs).toBe(T0 + 5_000)
    expect(session?.durationMs).toBe(0)
    expect(session?.sessionizationVersion).toBe(1)
  })

  test('session rows are stable across identical reruns', () => {
    seedEvent(db, ref, { id: 'v1.p-a1', name: 'chat_message_accepted', occurredAtMs: T0, props: messageProps() })
    seedEvent(db, ref, {
      id: 'v1.p-a2',
      name: 'chat_message_accepted',
      occurredAtMs: T0 + 10 * MIN,
      props: messageProps(),
    })
    runJob(db)
    const before = sessionsOf(db)
    runJob(db)
    expect(sessionsOf(db)).toEqual(before)
  })
})
