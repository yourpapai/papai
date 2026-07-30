// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  deriveEventTime,
  laterIso,
  toCanonicalPayload,
  toEventValues,
} from '../../src/long-term-memory/canonical-event-values.js'
import {
  CANONICAL_SCHEMA_VERSION,
  CAPTURE_VERSION,
  contentIdentity,
  idempotencyIdentity,
} from '../../src/long-term-memory/canonical-identity.js'
import type { MemoryRecordInput } from '../../src/long-term-memory/types.js'

/**
 * Every field below holds a value distinct from every other field's value (including across
 * timestamps), so a same-type field swap in the implementation — e.g. `validFrom` for
 * `validUntil`, or `eventId` wired into `idempotencyIdentity` — changes the asserted object and
 * fails the whole-object `toEqual` checks below. Field-by-field assertions cannot catch that
 * class of bug because a swap between two same-typed fields still passes each field's own check.
 */
const distinctFieldsInput = (): MemoryRecordInput =>
  input({
    id: 'rec-distinct-1',
    scopeId: 'scope-alpha',
    scopeType: 'group',
    kind: 'decision',
    content: 'the rollout ships friday',
    summary: 'ships friday summary',
    tags: ['alpha-tag', 'beta-tag'],
    confidence: 0.42,
    source: 'explicit',
    threadContextId: 'thread-99',
    evidence: {
      actorIds: ['actor-7'],
      messageIds: ['msg-3'],
      threads: ['thread-conv-5'],
      contextId: 'evctx-2',
      timestamps: ['2026-02-02T02:02:02.000Z'],
    },
    validFrom: '2026-03-03T03:03:03.000Z',
    validUntil: '2026-04-04T04:04:04.000Z',
    expiresAt: '2026-05-05T05:05:05.000Z',
    createdAt: '2026-01-01T01:01:01.000Z',
    updatedAt: '2026-01-06T06:06:06.000Z',
    lastSeenAt: '2026-01-07T07:07:07.000Z',
  })

/**
 * `values.tags`/`actorIds`/`provenance` type as optional because their columns carry a SQL
 * default, even though `toEventValues` always populates them — this hoists the null-coalescing
 * out of the test body so oxlint's `no-conditional-in-test` rule stays clean.
 */
const parseJsonField = (value: string | null | undefined, fallback: string): unknown => JSON.parse(value ?? fallback)

const input = (overrides: Partial<MemoryRecordInput> = {}): MemoryRecordInput => ({
  id: 'rec-1',
  scopeId: 'user-1',
  scopeType: 'personal',
  kind: 'fact',
  content: 'likes dark mode',
  summary: null,
  tags: ['ui'],
  confidence: 0.9,
  status: 'active',
  source: 'background',
  evidence: {},
  createdAt: '2026-07-30T12:00:00.000Z',
  updatedAt: '2026-07-30T12:00:00.000Z',
  lastSeenAt: '2026-07-30T12:00:00.000Z',
  ...overrides,
})

describe('deriveEventTime', () => {
  test('uses the latest evidence timestamp when evidence carries any', () => {
    const derived = deriveEventTime(
      input({
        evidence: { timestamps: ['2026-07-29T09:00:00.000Z', '2026-07-29T11:00:00.000Z'] },
      }),
    )
    expect(derived).toBe('2026-07-29T11:00:00.000Z')
  })

  test('picks the maximum regardless of the order timestamps arrive in', () => {
    const ascending = deriveEventTime(
      input({ evidence: { timestamps: ['2026-07-01T00:00:00.000Z', '2026-07-02T00:00:00.000Z'] } }),
    )
    const descending = deriveEventTime(
      input({ evidence: { timestamps: ['2026-07-02T00:00:00.000Z', '2026-07-01T00:00:00.000Z'] } }),
    )
    expect(ascending).toBe(descending)
  })

  test('falls back to createdAt when evidence has no timestamps', () => {
    expect(deriveEventTime(input())).toBe('2026-07-30T12:00:00.000Z')
  })

  test('falls back to createdAt when every evidence timestamp is unparsable', () => {
    expect(deriveEventTime(input({ evidence: { timestamps: ['not-a-date'] } }))).toBe('2026-07-30T12:00:00.000Z')
  })

  test('ignores unparsable timestamps mixed in with valid ones', () => {
    expect(deriveEventTime(input({ evidence: { timestamps: ['nonsense', '2026-07-05T00:00:00.000Z'] } }))).toBe(
      '2026-07-05T00:00:00.000Z',
    )
  })

  test('is not validFrom — a validity claim about the fact is not when the evidence occurred', () => {
    const derived = deriveEventTime(input({ validFrom: '2020-01-01T00:00:00.000Z' }))
    expect(derived).toBe('2026-07-30T12:00:00.000Z')
  })
})

describe('laterIso', () => {
  test('returns the later of two instants', () => {
    expect(laterIso('2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z')).toBe('2026-02-01T00:00:00.000Z')
    expect(laterIso('2026-02-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')).toBe('2026-02-01T00:00:00.000Z')
  })

  test('is idempotent on equal instants', () => {
    expect(laterIso('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')).toBe('2026-01-01T00:00:00.000Z')
  })

  test('keeps the first argument when the second is unparsable', () => {
    expect(laterIso('2026-01-01T00:00:00.000Z', 'garbage')).toBe('2026-01-01T00:00:00.000Z')
  })
})

describe('toCanonicalPayload', () => {
  test('lifts actor ids and provenance out of evidence', () => {
    const payload = toCanonicalPayload(
      input({
        evidence: { actorIds: ['a-1'], messageIds: ['m-1'], threads: ['t-1'], contextId: 'ctx-1' },
      }),
    )
    expect(payload.actorIds).toEqual(['a-1'])
    expect(payload.provenance).toEqual({ messageIds: ['m-1'], threads: ['t-1'], contextId: 'ctx-1' })
  })

  test('normalizes absent evidence to empty arrays and null, never undefined', () => {
    const payload = toCanonicalPayload(input())
    expect(payload.actorIds).toEqual([])
    expect(payload.provenance).toEqual({ messageIds: [], threads: [], contextId: null })
    expect(payload.summary).toBeNull()
    expect(payload.threadContextId).toBeNull()
  })

  test('pins every field at once, so a same-type field swap cannot slip through', () => {
    const payload = toCanonicalPayload(distinctFieldsInput())
    expect(payload).toEqual({
      scopeType: 'group',
      scopeId: 'scope-alpha',
      threadContextId: 'thread-99',
      kind: 'decision',
      content: 'the rollout ships friday',
      summary: 'ships friday summary',
      tags: ['alpha-tag', 'beta-tag'],
      confidence: 0.42,
      source: 'explicit',
      actorIds: ['actor-7'],
      provenance: { messageIds: ['msg-3'], threads: ['thread-conv-5'], contextId: 'evctx-2' },
      eventTime: '2026-02-02T02:02:02.000Z',
      validFrom: '2026-03-03T03:03:03.000Z',
      validUntil: '2026-04-04T04:04:04.000Z',
      expiresAt: '2026-05-05T05:05:05.000Z',
    })
  })
})

describe('toEventValues', () => {
  test('sets lastObservedAt to the event time and stamps both versions', () => {
    const recordInput = input()
    const payload = toCanonicalPayload(recordInput)
    const values = toEventValues({
      eventId: 'evt-1',
      identity: idempotencyIdentity(recordInput, recordInput.content),
      payload,
      input: recordInput,
      ingestTime: '2026-07-30T13:00:00.000Z',
      recordId: 'rec-1',
    })
    expect(values.lastObservedAt).toBe(values.eventTime)
    expect(values.eventTime).toBe('2026-07-30T12:00:00.000Z')
    expect(values.ingestTime).toBe('2026-07-30T13:00:00.000Z')
    expect(values.schemaVersion).toBe(1)
    expect(values.captureVersion).toBe('v1')
    expect(values.contentIdentity).toBe(contentIdentity(payload))
    expect(values.recordId).toBe('rec-1')
    expect(values.supersedes).toBeNull()
  })

  test('serializes tags, actor ids, and provenance as JSON text', () => {
    const recordInput = input({ tags: ['ui', 'theme'], evidence: { actorIds: ['a-1'] } })
    const payload = toCanonicalPayload(recordInput)
    const values = toEventValues({
      eventId: 'evt-1',
      identity: 'ident',
      payload,
      input: recordInput,
      ingestTime: '2026-07-30T13:00:00.000Z',
      recordId: null,
    })
    expect(parseJsonField(values.tags, '[]')).toEqual(['ui', 'theme'])
    expect(parseJsonField(values.actorIds, '[]')).toEqual(['a-1'])
    expect(parseJsonField(values.provenance, '{}')).toEqual({ messageIds: [], threads: [], contextId: null })
  })

  test('pins every column at once, so a same-type field swap cannot slip through', () => {
    const recordInput = distinctFieldsInput()
    const payload = toCanonicalPayload(recordInput)
    const identity = idempotencyIdentity(recordInput, recordInput.content)
    const values = toEventValues({
      eventId: 'event-123',
      identity,
      payload,
      input: recordInput,
      ingestTime: '2026-06-06T06:06:06.000Z',
      recordId: 'record-55',
    })

    // The two identity columns must never cross-wire: each is asserted against its own deriving
    // function, and they must differ from one another.
    expect(values.idempotencyIdentity).toBe(identity)
    expect(values.contentIdentity).toBe(contentIdentity(payload))
    expect(values.idempotencyIdentity).not.toBe(values.contentIdentity)

    expect(values).toEqual({
      eventId: 'event-123',
      idempotencyIdentity: identity,
      contentIdentity: contentIdentity(payload),
      scopeId: 'scope-alpha',
      scopeType: 'group',
      threadContextId: 'thread-99',
      kind: 'decision',
      content: 'the rollout ships friday',
      summary: 'ships friday summary',
      tags: JSON.stringify(['alpha-tag', 'beta-tag']),
      confidence: 0.42,
      source: 'explicit',
      actorIds: JSON.stringify(['actor-7']),
      provenance: JSON.stringify({ messageIds: ['msg-3'], threads: ['thread-conv-5'], contextId: 'evctx-2' }),
      eventTime: '2026-02-02T02:02:02.000Z',
      ingestTime: '2026-06-06T06:06:06.000Z',
      // Deliberately equal to eventTime, not a swap target: a fresh event is observed exactly
      // once, at its own event time (see the earlier test above).
      lastObservedAt: '2026-02-02T02:02:02.000Z',
      validFrom: '2026-03-03T03:03:03.000Z',
      validUntil: '2026-04-04T04:04:04.000Z',
      expiresAt: '2026-05-05T05:05:05.000Z',
      supersedes: null,
      recordId: 'record-55',
      schemaVersion: CANONICAL_SCHEMA_VERSION,
      captureVersion: CAPTURE_VERSION,
    })
  })
})
