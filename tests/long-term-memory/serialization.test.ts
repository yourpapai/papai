// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  deserializeEmbedding,
  parseEvidence,
  parseTags,
  sanitizeFtsQuery,
  serializeEmbedding,
} from '../../src/long-term-memory/serialization.js'

describe('parseTags', () => {
  test('parses a JSON array of strings', () => {
    expect(parseTags('["a","b"]')).toEqual(['a', 'b'])
  })
  test('returns empty array for invalid JSON', () => {
    expect(parseTags('not-json')).toEqual([])
  })
  test('returns empty array for non-array JSON', () => {
    expect(parseTags('"string"')).toEqual([])
  })
})

describe('parseEvidence', () => {
  test('parses a valid evidence object', () => {
    expect(parseEvidence('{"contextId":"ctx-1"}')).toEqual({ contextId: 'ctx-1' })
  })
  test('returns empty object for invalid JSON', () => {
    expect(parseEvidence('bad')).toEqual({})
  })
  test('returns empty object for array JSON', () => {
    expect(parseEvidence('[]')).toEqual({})
  })
})

describe('sanitizeFtsQuery', () => {
  test('wraps query in quotes', () => {
    expect(sanitizeFtsQuery('hello world')).toBe('"hello world"')
  })
  test('escapes embedded quotes', () => {
    expect(sanitizeFtsQuery('say "hi"')).toBe('"say ""hi"""')
  })
})

describe('serializeEmbedding', () => {
  test('serializes a Float32Array to a non-null Buffer', () => {
    expect(serializeEmbedding(new Float32Array([0.1, 0.2, 0.3]))).not.toBeNull()
  })
  test('serializes null to null', () => {
    expect(serializeEmbedding(null)).toBeNull()
  })
})

describe('deserializeEmbedding', () => {
  test('deserializes a Buffer back to a Float32Array with correct length', () => {
    const buf = serializeEmbedding(new Float32Array([0.1, 0.2, 0.3]))
    expect(deserializeEmbedding(buf)).toBeInstanceOf(Float32Array)
    expect(deserializeEmbedding(buf)).toHaveLength(3)
  })
  test('deserializes null to null', () => {
    expect(deserializeEmbedding(null)).toBeNull()
  })
})
