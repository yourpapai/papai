// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  extractPostId,
  mapOrderedPosts,
  normalizeBaseUrl,
  parseSince,
  shapePost,
} from '../../plugins/mcp-mattermost/format.js'

describe('mcp-mattermost format', () => {
  describe('normalizeBaseUrl', () => {
    test('replaces wss:// with https:// and strips trailing slash', () => {
      expect(normalizeBaseUrl('wss://mm.x/')).toBe('https://mm.x')
    })

    test('replaces ws:// with http://', () => {
      expect(normalizeBaseUrl('ws://mm.x')).toBe('http://mm.x')
    })

    test('strips multiple trailing slashes', () => {
      expect(normalizeBaseUrl('https://mm.x///')).toBe('https://mm.x')
    })

    test('leaves an already-normalized URL unchanged', () => {
      expect(normalizeBaseUrl('https://mm.x')).toBe('https://mm.x')
    })
  })

  describe('extractPostId', () => {
    test('extracts the id from a /_redirect/pl/ permalink', () => {
      expect(extractPostId('https://mm.x/_redirect/pl/AbC123')).toBe('AbC123')
    })

    test('extracts the id from a team/channel permalink', () => {
      expect(extractPostId('https://mm.x/team/chan/pl/XY9')).toBe('XY9')
    })

    test('trims a bare id with no permalink shape', () => {
      expect(extractPostId('  bareId ')).toBe('bareId')
    })
  })

  describe('parseSince', () => {
    test('returns undefined for undefined', () => {
      expect(parseSince(undefined)).toBeUndefined()
    })

    test('returns a number as-is', () => {
      expect(parseSince(1_700_000_000_000)).toBe(1_700_000_000_000)
    })

    test('parses a numeric string as epoch millis', () => {
      expect(parseSince('1700000000000')).toBe(1_700_000_000_000)
    })

    test('parses an ISO date string via Date.parse', () => {
      expect(parseSince('2023-01-01T00:00:00Z')).toBe(Date.parse('2023-01-01T00:00:00Z'))
    })

    test('throws on an unparseable string', () => {
      expect(() => parseSince('not-a-date')).toThrow('Invalid since value: not-a-date')
    })
  })

  describe('shapePost', () => {
    test('picks only known fields and drops props/metadata', () => {
      const raw = {
        id: 'p1',
        message: 'hi',
        user_id: 'u1',
        channel_id: 'c1',
        create_at: 5,
        update_at: 6,
        edit_at: 0,
        root_id: '',
        file_ids: ['f1', '', 7],
        props: { x: 1 },
        metadata: { y: 2 },
      }

      expect(shapePost(raw)).toEqual({
        id: 'p1',
        message: 'hi',
        user_id: 'u1',
        channel_id: 'c1',
        create_at: 5,
        update_at: 6,
        edit_at: 0,
        root_id: '',
        file_ids: ['f1', ''],
      })
    })

    test('returns an empty object for null', () => {
      expect(shapePost(null)).toEqual({})
    })

    test('returns an empty object for a non-record primitive', () => {
      expect(shapePost('x')).toEqual({})
    })
  })

  describe('mapOrderedPosts', () => {
    test('maps ids through order, dropping missing ids, shaping each post', () => {
      const raw = {
        posts: {
          p1: { id: 'p1', message: 'a' },
          p2: { id: 'p2', message: 'b' },
        },
        order: ['p2', 'p1', 'pX'],
      }

      expect(mapOrderedPosts(raw)).toEqual([
        { id: 'p2', message: 'b' },
        { id: 'p1', message: 'a' },
      ])
    })

    test('returns an empty array for null', () => {
      expect(mapOrderedPosts(null)).toEqual([])
    })

    test('returns an empty array for a record missing posts/order', () => {
      expect(mapOrderedPosts({})).toEqual([])
    })
  })
})
