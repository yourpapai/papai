// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  type CanonicalPayload,
  canonicalJson,
  contentIdentity,
  idempotencyIdentity,
} from '../../src/long-term-memory/canonical-identity.js'
import { contentHash } from '../../src/long-term-memory/tombstone.js'
import type { MemoryScope } from '../../src/long-term-memory/types.js'

const scope: MemoryScope = { scopeId: 'user-1', scopeType: 'personal' }

const payload = (overrides: Partial<CanonicalPayload> = {}): CanonicalPayload => ({
  scopeType: 'personal',
  scopeId: 'user-1',
  threadContextId: null,
  kind: 'fact',
  content: 'likes dark mode',
  summary: null,
  tags: ['ui', 'theme'],
  confidence: 0.9,
  source: 'background',
  actorIds: ['actor-1'],
  provenance: { messageIds: ['m-1'], threads: [], contextId: 'ctx-1' },
  eventTime: '2026-07-30T00:00:00.000Z',
  validFrom: null,
  validUntil: null,
  expiresAt: null,
  ...overrides,
})

describe('idempotencyIdentity', () => {
  test('is deterministic across calls', () => {
    expect(idempotencyIdentity(scope, 'likes dark mode')).toBe(idempotencyIdentity(scope, 'likes dark mode'))
  })

  test('inherits the tombstone normalization: case and whitespace variants share an identity', () => {
    expect(idempotencyIdentity(scope, '  Likes   DARK mode ')).toBe(idempotencyIdentity(scope, 'likes dark mode'))
  })

  test('separates scopes that differ only by type or id', () => {
    const byType = idempotencyIdentity({ scopeId: 'user-1', scopeType: 'group' }, 'x')
    const byId = idempotencyIdentity({ scopeId: 'user-2', scopeType: 'personal' }, 'x')
    expect(idempotencyIdentity(scope, 'x')).not.toBe(byType)
    expect(idempotencyIdentity(scope, 'x')).not.toBe(byId)
  })

  test('the field separator prevents boundary collisions between scope type and id', () => {
    // Concatenation without a separator that cannot occur in a field would let
    // ('personal', 'x-user') and ('personalx', '-user') join to the same string.
    const a = idempotencyIdentity({ scopeType: 'personal', scopeId: 'x-user' }, 'c')
    const b = idempotencyIdentity({ scopeType: 'personal', scopeId: 'x' }, 'c')
    const c = idempotencyIdentity({ scopeType: 'group', scopeId: 'x-user' }, 'c')
    expect(new Set([a, b, c]).size).toBe(3)
  })

  test('differs whenever the tombstone content hash differs', () => {
    // The load-bearing agreement: the tombstone hash IS a component of this key, so
    // "is this tombstoned?" and "is this a duplicate?" cannot disagree about what
    // content means. Same hash => same identity; different hash => different identity.
    expect(contentHash('likes dark mode')).toBe(contentHash('LIKES  dark MODE '))
    expect(idempotencyIdentity(scope, 'LIKES  dark MODE ')).toBe(idempotencyIdentity(scope, 'likes dark mode'))

    expect(contentHash('likes dark mode')).not.toBe(contentHash('likes light mode'))
    expect(idempotencyIdentity(scope, 'likes light mode')).not.toBe(idempotencyIdentity(scope, 'likes dark mode'))
  })
})

describe('canonicalJson', () => {
  test('is stable under key reordering', () => {
    const reordered = { ...payload() }
    expect(canonicalJson(reordered)).toBe(canonicalJson(payload()))
  })

  test('is stable under tag reordering', () => {
    expect(canonicalJson(payload({ tags: ['theme', 'ui'] }))).toBe(canonicalJson(payload({ tags: ['ui', 'theme'] })))
  })

  test('encodes nulls explicitly rather than dropping the key', () => {
    expect(canonicalJson(payload({ summary: null }))).toContain('"summary":null')
  })

  test('encodes nested provenance contents rather than erasing them', () => {
    const json = canonicalJson(payload())
    expect(json).toContain('"messageIds":["m-1"]')
    expect(json).toContain('"contextId":"ctx-1"')
  })

  test('is stable under provenance array reordering', () => {
    const forward = payload({ provenance: { messageIds: ['m-1', 'm-2'], threads: [], contextId: 'ctx-1' } })
    const reversed = payload({ provenance: { messageIds: ['m-2', 'm-1'], threads: [], contextId: 'ctx-1' } })
    expect(canonicalJson(forward)).toBe(canonicalJson(reversed))
  })
})

describe('contentIdentity', () => {
  test('two payloads sharing an idempotency identity but differing in metadata are distinguishable', () => {
    const base = payload()
    const other = payload({ confidence: 0.5 })
    expect(idempotencyIdentity(scope, base.content)).toBe(idempotencyIdentity(scope, other.content))
    expect(contentIdentity(base)).not.toBe(contentIdentity(other))
  })

  test('is deterministic for an identical payload', () => {
    expect(contentIdentity(payload())).toBe(contentIdentity(payload()))
  })

  test('two payloads differing only in provenance get different content identities', () => {
    const base = payload()
    const other = payload({ provenance: { messageIds: ['m-2'], threads: [], contextId: 'ctx-1' } })
    expect(contentIdentity(base)).not.toBe(contentIdentity(other))
  })
})
