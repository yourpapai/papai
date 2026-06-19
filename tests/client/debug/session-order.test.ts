// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { pinOperatorFirst } from '../../../client/debug/session-order.js'

describe('pinOperatorFirst', () => {
  const entries: Array<[string, number]> = [
    ['a', 1],
    ['op', 2],
    ['b', 3],
  ]

  test('moves the operator entry to the front, preserving other order', () => {
    expect(pinOperatorFirst(entries, 'op')).toEqual([
      ['op', 2],
      ['a', 1],
      ['b', 3],
    ])
  })

  test('returns the original order when the operator has no session', () => {
    expect(pinOperatorFirst(entries, 'missing')).toEqual(entries)
  })

  test('returns the original order when no operator id is known', () => {
    expect(pinOperatorFirst(entries, undefined)).toEqual(entries)
  })
})
