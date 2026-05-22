// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import type { IdentityMapping, UserIdentity } from '../../src/identity/types.js'
import { isMatchMethod } from '../../src/identity/types.js'

describe('identity types', () => {
  it('should define IdentityMapping interface', () => {
    const mapping: IdentityMapping = {
      contextId: 'user-123',
      providerName: 'youtrack',
      providerUserId: 'yt-user-456',
      providerUserLogin: 'jsmith',
      displayName: 'John Smith',
      matchedAt: '2026-04-10T10:00:00Z',
      matchMethod: 'auto',
      confidence: 100,
    }
    expect(mapping.contextId).toBe('user-123')
    expect(mapping.matchMethod).toBe('auto')
  })

  it('should define UserIdentity interface', () => {
    const identity: UserIdentity = {
      userId: 'yt-user-456',
      login: 'jsmith',
      displayName: 'John Smith',
    }
    expect(identity.login).toBe('jsmith')
  })

  it('should support MatchMethod type', () => {
    const methods = ['auto', 'manual_nl', 'unmatched'] as const
    expect(methods).toContain('auto')
    expect(methods).toContain('manual_nl')
    expect(methods).toContain('unmatched')
  })

  describe('isMatchMethod', () => {
    it('should return true for valid match methods', () => {
      expect(isMatchMethod('auto')).toBe(true)
      expect(isMatchMethod('manual_nl')).toBe(true)
      expect(isMatchMethod('unmatched')).toBe(true)
    })

    it('should return false for invalid match methods', () => {
      expect(isMatchMethod('invalid')).toBe(false)
      expect(isMatchMethod('')).toBe(false)
      expect(isMatchMethod('AUTO')).toBe(false)
    })

    it('should return false for null and undefined', () => {
      expect(isMatchMethod(null)).toBe(false)
      expect(isMatchMethod(undefined)).toBe(false)
    })
  })
})
