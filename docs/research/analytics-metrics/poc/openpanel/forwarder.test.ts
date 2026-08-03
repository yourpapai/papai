// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'

import { forwardMappedEvents } from './forwarder.js'
import { getDelivery, initializeDeliveryLedger } from './ledger.js'
import type { MappedCanonicalEvent, OpenPanelTrackRequest } from './mapping.js'
import type { DeliveryResult } from './transport-types.js'

const EVENT_ID = 'b'.repeat(64)

function mappedEvent(eventId = EVENT_ID): MappedCanonicalEvent {
  const request: OpenPanelTrackRequest = {
    type: 'track',
    payload: {
      name: 'turn_completed',
      profileId: 'syn_0123456789abcdef0123456789abcdef',
      properties: {
        __timestamp: '2026-05-01T10:00:00.000Z',
        event_id: eventId,
        schema_version: 1,
      },
    },
  }
  return { eventId, request }
}

function withLedger(run: (database: Database) => void | Promise<void>): Promise<void> {
  return Promise.resolve().then(async () => {
    using database = new Database(':memory:', { strict: true })
    initializeDeliveryLedger(database)
    await run(database)
  })
}

const delivered = (): Promise<DeliveryResult> => Promise.resolve({ kind: 'delivered', status: 200 })

test('suppresses ordinary replay after a known acknowledgement', () =>
  withLedger(async (database) => {
    let calls = 0
    const send = (): Promise<DeliveryResult> => {
      calls += 1
      return delivered()
    }

    const first = await forwardMappedEvents({
      concurrency: 2,
      database,
      events: [mappedEvent()],
      maxAttempts: 3,
      nowMs: () => 10,
      send,
      sinkId: 'openpanel-local',
    })
    const rerun = await forwardMappedEvents({
      concurrency: 2,
      database,
      events: [mappedEvent()],
      maxAttempts: 3,
      nowMs: () => 20,
      send,
      sinkId: 'openpanel-local',
    })

    expect(calls).toBe(1)
    expect(first.attempted).toBe(1)
    expect(rerun.attempted).toBe(0)
    expect(getDelivery(database, EVENT_ID, 'openpanel-local')).toMatchObject({
      attempts: 1,
      state: 'delivered',
    })
  }))

test('keeps an ambiguous acknowledgement visible and out of automatic retries', () =>
  withLedger(async (database) => {
    let calls = 0
    const send = (): Promise<DeliveryResult> => {
      calls += 1
      return Promise.resolve({ errorClass: 'ambiguous_ack', kind: 'ambiguous' })
    }
    const options = {
      concurrency: 1,
      database,
      events: [mappedEvent()],
      maxAttempts: 3,
      nowMs: () => 10,
      send,
      sinkId: 'openpanel-local',
    } as const

    await forwardMappedEvents(options)
    await forwardMappedEvents({ ...options, nowMs: () => 20 })

    expect(calls).toBe(1)
    expect(getDelivery(database, EVENT_ID, 'openpanel-local')).toMatchObject({
      attempts: 1,
      last_error_class: 'ambiguous_ack',
      state: 'ambiguous',
    })
  }))

test('tracks attempts independently for the same event in separate sinks', () =>
  withLedger(async (database) => {
    const base = {
      concurrency: 1,
      database,
      events: [mappedEvent()],
      maxAttempts: 3,
      nowMs: () => 10,
      send: delivered,
    } as const

    await forwardMappedEvents({ ...base, sinkId: 'openpanel-a' })
    await forwardMappedEvents({ ...base, sinkId: 'openpanel-b' })

    expect(getDelivery(database, EVENT_ID, 'openpanel-a')).toMatchObject({
      attempts: 1,
      state: 'delivered',
    })
    expect(getDelivery(database, EVENT_ID, 'openpanel-b')).toMatchObject({
      attempts: 1,
      state: 'delivered',
    })
  }))

test('bounds explicit retryable failures and then marks the delivery dead', () =>
  withLedger(async (database) => {
    const send = (): Promise<DeliveryResult> =>
      Promise.resolve({ errorClass: 'http_retryable', kind: 'retryable', status: 503 })
    const base = {
      concurrency: 1,
      database,
      events: [mappedEvent()],
      maxAttempts: 2,
      nowMs: () => 10,
      send,
      sinkId: 'openpanel-local',
    } as const

    await forwardMappedEvents(base)
    expect(getDelivery(database, EVENT_ID, 'openpanel-local')?.state).toBe('pending')
    await forwardMappedEvents({ ...base, nowMs: () => 20 })

    expect(getDelivery(database, EVENT_ID, 'openpanel-local')).toMatchObject({
      attempts: 2,
      last_error_class: 'http_retryable',
      state: 'dead',
    })
  }))
