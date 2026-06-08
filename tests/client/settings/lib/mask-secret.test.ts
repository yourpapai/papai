// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { maskSecret } from '../../../../client/settings/lib/mask-secret.js'

describe('maskSecret', () => {
  test('converts leading asterisks to bullets, keeps the tail', () => {
    expect(maskSecret('****WvfQ')).toBe('••••WvfQ')
    expect(maskSecret('****d2a0')).toBe('••••d2a0')
  })
  test('replaces any asterisk run with bullets', () => {
    expect(maskSecret('ab**cd')).toBe('ab••cd')
  })
  test('passes through values with no asterisks', () => {
    expect(maskSecret('plain')).toBe('plain')
  })
  test('handles empty string', () => {
    expect(maskSecret('')).toBe('')
  })
})
