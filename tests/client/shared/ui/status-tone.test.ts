// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { statusTone } from '../../../../client/shared/ui/status-tone'

describe('statusTone', () => {
  test.each([
    ['active', 'accent'],
    ['enabled', 'accent'],
    ['auto', 'info'],
    ['pending', 'warn'],
    ['failed', 'danger'],
    ['unmatched', 'mute'],
    ['unknown', 'mute'],
  ] as const)('maps %s -> %s', (status, tone) => {
    expect(statusTone(status)).toBe(tone)
  })
  test('is case-insensitive', () => {
    expect(statusTone('ACTIVE')).toBe('accent')
  })
  test('falls back to neutral for unrecognized values', () => {
    expect(statusTone('frobnicated')).toBe('neutral')
  })
})
