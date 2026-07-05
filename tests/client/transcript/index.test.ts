// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { tokenFromPath } from '../../../client/transcript/index.js'

describe('tokenFromPath', () => {
  test('extracts the token segment from a bare token path', () => {
    expect(tokenFromPath('/t/abc')).toBe('abc')
  })

  test('extracts the token segment when trailed by extra path segments', () => {
    expect(tokenFromPath('/t/abc/stream')).toBe('abc')
  })

  test('decodes percent-encoded characters', () => {
    expect(tokenFromPath('/t/a%20b')).toBe('a b')
  })

  test('falls back to the raw segment on malformed encoding', () => {
    expect(tokenFromPath('/t/%E0%A4%A')).toBe('%E0%A4%A')
  })
})
