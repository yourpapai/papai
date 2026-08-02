// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { panelCount } from '../../../client/debug/panel-count.js'

describe('panelCount', () => {
  test('returns bare total when filter is all', () => {
    expect(panelCount(5, 5, 'all')).toBe('5')
  })

  test('returns filtered/total when a scope filter is active', () => {
    expect(panelCount(1, 5, 'dm')).toBe('1/5')
    expect(panelCount(0, 5, 'group')).toBe('0/5')
  })
})
