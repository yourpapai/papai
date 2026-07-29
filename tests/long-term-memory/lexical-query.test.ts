// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { buildFtsMatchQuery, tokenizeQuery } from '../../src/long-term-memory/lexical-query.js'

describe('tokenizeQuery', () => {
  test('tokenizes Cyrillic', () => {
    expect(tokenizeQuery('Маршруты доставки')).toEqual(['маршруты', 'доставки'])
  })

  test('tokenizes mixed scripts and digits', () => {
    expect(tokenizeQuery('deploy маршрут v2')).toEqual(['deploy', 'маршрут', 'v2'])
  })

  test('drops punctuation and whitespace', () => {
    expect(tokenizeQuery('  what?! is - the plan...  ')).toEqual(['what', 'is', 'the', 'plan'])
  })

  test('returns an empty array for punctuation-only and empty input', () => {
    expect(tokenizeQuery('?!.,  ')).toEqual([])
    expect(tokenizeQuery('')).toEqual([])
  })
})

describe('buildFtsMatchQuery', () => {
  test('emits quoted prefix terms joined by OR', () => {
    expect(buildFtsMatchQuery('маршрут доставка')).toBe('"маршрут"* OR "доставка"*')
  })

  test('deduplicates repeated tokens', () => {
    expect(buildFtsMatchQuery('plan plan PLAN')).toBe('"plan"*')
  })

  test('returns null when there are no tokens', () => {
    expect(buildFtsMatchQuery('?!.,')).toBeNull()
    expect(buildFtsMatchQuery('')).toBeNull()
  })

  test('produces no bare quote for adversarial input', () => {
    const built = buildFtsMatchQuery('drop" table OR "x')
    expect(built).toBe('"drop"* OR "table"* OR "or"* OR "x"*')
  })
})
