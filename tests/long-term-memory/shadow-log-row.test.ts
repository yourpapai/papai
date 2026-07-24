// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { buildShadowLogRow } from '../../src/long-term-memory/shadow-log-row.js'
import type { ShadowOutcome } from '../../src/long-term-memory/shadow-log-row.js'
import { keyedHash } from '../../src/stats/hashing.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const HEX64_HASH_PATTERN = /^[0-9a-f]{64}$/u

// turnRef/readerModelId are opaque identifiers passed through by design (see spec:
// "turn_ref | opaque turn id / ordinal, already opaque"; readerModelId is the
// reported keying variable) — never free-form content.
const PASSTHROUGH_IDENTIFIER_KEYS: ReadonlySet<string> = new Set(['turnRef', 'readerModelId'])

const ENUM_ALLOW_LISTS: Readonly<Record<string, readonly string[]>> = {
  shadowQueryLenBucket: ['short', 'medium', 'long'],
  shadowTopProvenance: ['current', 'group', 'other-thread'],
  skippedReason: ['no-active-records'],
}

function stringEntriesOf(row: Record<string, unknown>): ReadonlyArray<[string, string]> {
  return Object.entries(row).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
}

function firstOf(values: readonly string[]): string {
  return values[0] ?? ''
}

function partitionRowStringFields(row: Record<string, unknown>): {
  enumFields: ReadonlyArray<[string, string]>
  hashFields: ReadonlyArray<[string, string]>
} {
  const nonPassthrough = stringEntriesOf(row).filter(([key]) => !PASSTHROUGH_IDENTIFIER_KEYS.has(key))
  const enumFields = nonPassthrough.filter(([key]) => key in ENUM_ALLOW_LISTS)
  const hashFields = nonPassthrough.filter(([key]) => !(key in ENUM_ALLOW_LISTS))
  return { enumFields, hashFields }
}

const baseOutcome: ShadowOutcome = {
  scope: 'group:acme-workspace',
  contextId: 'thread-42-config-context',
  turnRef: 'turn-1234',
  readerModelId: 'gpt-4o-mini',
  activeRecordCount: 7,
  shadowQuery: 'what did we decide about the pricing rollout last week',
  shadowHits: [
    { id: 'record-alpha', score: 0.91, provenance: 'current' },
    { id: 'record-beta', score: 0.42, provenance: 'group' },
  ],
  pull: {
    pulled: true,
    queries: ['pricing rollout decision'],
    resultIds: ['record-beta', 'record-gamma'],
  },
}

describe('buildShadowLogRow', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('hashes scope, context, shadow query, top record id, and pull query with keyedHash', () => {
    const row = buildShadowLogRow(baseOutcome)

    expect(row.scopeHash).toBe(keyedHash(baseOutcome.scope))
    expect(row.contextHash).toBe(keyedHash(baseOutcome.contextId))
    expect(row.shadowQueryHash).toBe(keyedHash(baseOutcome.shadowQuery))
    expect(row.shadowTopRecordHash).toBe(keyedHash('record-alpha'))
    expect(row.pullQueryHash).toBe(keyedHash('pricing rollout decision'))
  })

  test('hash outputs never equal the raw values they were derived from', () => {
    const row = buildShadowLogRow(baseOutcome)

    expect(row.scopeHash).not.toBe(baseOutcome.scope)
    expect(row.contextHash).not.toBe(baseOutcome.contextId)
    expect(row.shadowQueryHash).not.toBe(baseOutcome.shadowQuery)
    expect(row.shadowTopRecordHash).not.toBe('record-alpha')
    expect(row.pullQueryHash).not.toBe('pricing rollout decision')
  })

  test('anonymity guard: every non-passthrough string field is a 64-char hex hash', () => {
    const row = buildShadowLogRow(baseOutcome)
    const { hashFields } = partitionRowStringFields(row)

    for (const [, value] of hashFields) {
      expect(value).toMatch(HEX64_HASH_PATTERN)
    }
    expect(hashFields.length).toBeGreaterThan(0)
  })

  test('anonymity guard: every enum-typed string field belongs to its fixed allow-list', () => {
    const row = buildShadowLogRow(baseOutcome)
    const { enumFields } = partitionRowStringFields(row)

    for (const [key, value] of enumFields) {
      expect(ENUM_ALLOW_LISTS[key]).toContain(value)
    }
    expect(enumFields.length).toBeGreaterThan(0)
  })

  test('anonymity guard: no field carries the raw query, pull query, or record ids verbatim', () => {
    const row = buildShadowLogRow(baseOutcome)
    const firstPullQuery = firstOf(baseOutcome.pull.queries)
    const rawContentStrings = [baseOutcome.shadowQuery, firstPullQuery, 'record-alpha', 'record-beta', 'record-gamma']
    const stringValues = stringEntriesOf(row).map(([, value]) => value)

    for (const raw of rawContentStrings) {
      expect(stringValues).not.toContain(raw)
    }
  })

  test('shadow_pull_overlap counts id-intersection between shadow top-k and pull results', () => {
    const row = buildShadowLogRow(baseOutcome)

    // shadowHits ids: record-alpha, record-beta; pull resultIds: record-beta, record-gamma -> overlap 1
    expect(row.shadowPullOverlap).toBe(1)
  })

  test('shadow_pull_overlap is 0 when there is no id intersection', () => {
    const outcome: ShadowOutcome = {
      ...baseOutcome,
      shadowHits: [{ id: 'record-x', score: 0.5, provenance: 'current' }],
      pull: { pulled: true, queries: ['q'], resultIds: ['record-y'] },
    }

    const row = buildShadowLogRow(outcome)

    expect(row.shadowPullOverlap).toBe(0)
  })

  test('shadow_pull_overlap counts full overlap when all ids match', () => {
    const outcome: ShadowOutcome = {
      ...baseOutcome,
      shadowHits: [
        { id: 'record-a', score: 0.9, provenance: 'current' },
        { id: 'record-b', score: 0.8, provenance: 'current' },
      ],
      pull: { pulled: true, queries: ['q'], resultIds: ['record-a', 'record-b'] },
    }

    const row = buildShadowLogRow(outcome)

    expect(row.shadowPullOverlap).toBe(2)
  })

  test('buckets a short shadow query length', () => {
    const row = buildShadowLogRow({ ...baseOutcome, shadowQuery: 'hi' })

    expect(row.shadowQueryLenBucket).toBe('short')
  })

  test('buckets a medium shadow query length', () => {
    const row = buildShadowLogRow({ ...baseOutcome, shadowQuery: 'x'.repeat(40) })

    expect(row.shadowQueryLenBucket).toBe('medium')
  })

  test('buckets a long shadow query length', () => {
    const row = buildShadowLogRow({ ...baseOutcome, shadowQuery: 'x'.repeat(200) })

    expect(row.shadowQueryLenBucket).toBe('long')
  })

  test('derives modelPulled, pullCount, pullResultCount, shadowHitCount, top score/provenance from the outcome', () => {
    const row = buildShadowLogRow(baseOutcome)

    expect(row.modelPulled).toBe(true)
    expect(row.pullCount).toBe(1)
    expect(row.pullResultCount).toBe(2)
    expect(row.shadowHitCount).toBe(2)
    expect(row.shadowTopScore).toBeCloseTo(0.91)
    expect(row.shadowTopProvenance).toBe('current')
  })

  test('handles zero shadow hits: null top score/provenance/record hash, zero hit count', () => {
    const outcome: ShadowOutcome = { ...baseOutcome, shadowHits: [] }

    const row = buildShadowLogRow(outcome)

    expect(row.shadowHitCount).toBe(0)
    expect(row.shadowTopScore).toBeNull()
    expect(row.shadowTopProvenance).toBeNull()
    expect(row.shadowTopRecordHash).toBeNull()
  })

  test('handles no model pull: modelPulled false, zero counts, null pullQueryHash, zero overlap', () => {
    const outcome: ShadowOutcome = {
      ...baseOutcome,
      pull: { pulled: false, queries: [], resultIds: [] },
    }

    const row = buildShadowLogRow(outcome)

    expect(row.modelPulled).toBe(false)
    expect(row.pullCount).toBe(0)
    expect(row.pullResultCount).toBe(0)
    expect(row.pullQueryHash).toBeNull()
    expect(row.shadowPullOverlap).toBe(0)
  })

  test('passes through turnRef, readerModelId, activeRecordCount; skippedReason is null', () => {
    const row = buildShadowLogRow(baseOutcome)

    expect(row.turnRef).toBe(baseOutcome.turnRef)
    expect(row.readerModelId).toBe(baseOutcome.readerModelId)
    expect(row.activeRecordCount).toBe(baseOutcome.activeRecordCount)
    expect(row.skippedReason).toBeNull()
  })
})
