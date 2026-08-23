// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  GroupReleaseSubscriptionResponseSchema,
  ReleaseBroadcastResultSchema,
  ReleaseNotesResponseSchema,
  ReleaseSubscriptionResponseSchema,
} from '../../../client/settings/fetcher-schemas-release.js'

describe('ReleaseSubscriptionResponseSchema', () => {
  test('parses { enabled: true }', () => {
    const parsed = ReleaseSubscriptionResponseSchema.parse({ enabled: true })
    expect(parsed.enabled).toBe(true)
  })

  test('throws on missing enabled', () => {
    expect(() => ReleaseSubscriptionResponseSchema.parse({})).toThrow()
  })
})

describe('GroupReleaseSubscriptionResponseSchema', () => {
  test('parses a valid response', () => {
    const parsed = GroupReleaseSubscriptionResponseSchema.parse({ contextId: 'g:1', enabled: false })
    expect(parsed.contextId).toBe('g:1')
    expect(parsed.enabled).toBe(false)
  })

  test('throws when contextId is missing', () => {
    expect(() => GroupReleaseSubscriptionResponseSchema.parse({ enabled: true })).toThrow()
  })
})

describe('ReleaseNotesResponseSchema', () => {
  test('parses a full release notes payload', () => {
    const parsed = ReleaseNotesResponseSchema.parse({
      version: '1.2.3',
      bodies: { en: 'Some notes', ru: 'Некоторые заметки' },
      broadcastAt: '2026-06-01T00:00:00Z',
      counts: { dm: 10, group: 3 },
    })
    expect(parsed.version).toBe('1.2.3')
    expect(parsed.bodies.en).toBe('Some notes')
    expect(parsed.counts.dm).toBe(10)
  })

  test('accepts null bodies and broadcastAt', () => {
    const parsed = ReleaseNotesResponseSchema.parse({
      version: '1.0.0',
      bodies: { en: null, ru: null },
      broadcastAt: null,
      counts: { dm: 0, group: 0 },
    })
    expect(parsed.bodies.en).toBeNull()
    expect(parsed.bodies.ru).toBeNull()
    expect(parsed.broadcastAt).toBeNull()
  })

  test('throws when counts is missing', () => {
    expect(() =>
      ReleaseNotesResponseSchema.parse({ version: '1.0.0', bodies: { en: null, ru: null }, broadcastAt: null }),
    ).toThrow()
  })
})

describe('ReleaseBroadcastResultSchema', () => {
  test('parses a broadcast result', () => {
    const parsed = ReleaseBroadcastResultSchema.parse({
      version: '1.2.3',
      broadcast: { sent: 8, failed: 1, skipped: 2 },
      counts: { dm: 5, group: 3 },
    })
    expect(parsed.broadcast.sent).toBe(8)
    expect(parsed.counts.group).toBe(3)
  })

  test('throws when broadcast fields are wrong type', () => {
    expect(() =>
      ReleaseBroadcastResultSchema.parse({
        version: '1.2.3',
        broadcast: { sent: 'eight', failed: 1, skipped: 2 },
        counts: { dm: 5, group: 3 },
      }),
    ).toThrow()
  })
})
