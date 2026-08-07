// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { shouldFollow } from '../../../client/transcript/autoscroll.js'

describe('shouldFollow', () => {
  test('follows when the viewport is flush with the bottom', () => {
    expect(shouldFollow(900, 100, 1000)).toBe(true)
  })

  test('does not follow when the reader has scrolled well up', () => {
    expect(shouldFollow(0, 100, 5000)).toBe(false)
  })

  test('follows exactly at the slack boundary', () => {
    expect(shouldFollow(836, 100, 1000)).toBe(true)
  })

  test('stops following one pixel past the slack boundary', () => {
    expect(shouldFollow(835, 100, 1000)).toBe(false)
  })

  test('honours a custom slack', () => {
    expect(shouldFollow(800, 100, 1000, 200)).toBe(true)
    expect(shouldFollow(800, 100, 1000)).toBe(false)
  })

  test('follows on a page shorter than the viewport, where there is nothing to scroll', () => {
    expect(shouldFollow(0, 1000, 500)).toBe(true)
  })
})
