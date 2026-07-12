// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { parseBunInteger } from '../../scripts/story-runner-integers.js'

describe('parseBunInteger', () => {
  test.each([
    ['0', 0],
    ['+1', 1],
    ['001', 1],
  ])('accepts Bun-compatible integer token %s', (token, expected) => {
    expect(parseBunInteger(token, { flag: '--seed', minimum: 0, maximum: 4_294_967_295 })).toBe(expected)
  })

  test.each(['', ' ', '-1', '1.0', '1e2', '+', '9007199254740992'])(
    'rejects non-Bun or unsafe integer token %s',
    (token) => {
      expect(() => parseBunInteger(token, { flag: '--seed', minimum: 0 })).toThrow('--seed requires an integer')
    },
  )
})
