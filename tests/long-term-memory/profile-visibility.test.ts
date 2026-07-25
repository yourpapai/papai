// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { visibleProfileText } from '../../src/long-term-memory/profile-visibility.js'
import type { MemoryProfile } from '../../src/long-term-memory/types.js'

const profile = (overrides: Partial<MemoryProfile> = {}): MemoryProfile => ({
  scopeId: 'u-1',
  scopeType: 'personal',
  profile: 'User lives in Berlin',
  enabled: true,
  injectRecords: false,
  contaminatedAt: null,
  version: 1,
  updatedAt: '2026-07-25T00:00:00.000Z',
  ...overrides,
})

describe('visibleProfileText', () => {
  test('returns the prose when the profile is clean', () => {
    expect(visibleProfileText(profile())).toBe('User lives in Berlin')
  })

  test('returns null when the profile is contaminated', () => {
    expect(visibleProfileText(profile({ contaminatedAt: '2026-07-25T10:00:00.000Z' }))).toBeNull()
  })

  test('returns null for a missing profile', () => {
    expect(visibleProfileText(null)).toBeNull()
  })

  test('returns null for empty prose so callers never emit an empty section', () => {
    expect(visibleProfileText(profile({ profile: '' }))).toBeNull()
    expect(visibleProfileText(profile({ profile: '   ' }))).toBeNull()
  })
})
