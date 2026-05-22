// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { parseIsoToMs, safeParseTags } from '../../../src/stats/internal/util.js'

describe('parseIsoToMs', () => {
  test('returns null for null or empty input', () => {
    expect(parseIsoToMs(null)).toBeNull()
    expect(parseIsoToMs('')).toBeNull()
  })

  test('parses standard ISO timestamps', () => {
    expect(parseIsoToMs('2026-01-01T00:00:00Z')).toBe(Date.parse('2026-01-01T00:00:00Z'))
  })

  test('parses space-separated SQLite datetime by inserting T and Z', () => {
    expect(parseIsoToMs('2026-01-01 00:00:00')).toBe(Date.parse('2026-01-01T00:00:00Z'))
  })

  test('returns null on garbage input', () => {
    expect(parseIsoToMs('not-a-date')).toBeNull()
  })
})

describe('safeParseTags', () => {
  test('returns an array of strings on valid JSON array', () => {
    expect(safeParseTags('["a","b"]')).toEqual(['a', 'b'])
  })

  test('skips non-string entries', () => {
    expect(safeParseTags('["a",1,"b",null]')).toEqual(['a', 'b'])
  })

  test('returns empty array on malformed JSON', () => {
    expect(safeParseTags('not-json')).toEqual([])
  })

  test('returns empty array on non-array JSON', () => {
    expect(safeParseTags('{"a":1}')).toEqual([])
  })
})
