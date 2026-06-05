// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Tests for Mattermost file helpers
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test'

import {
  resolveMattermostUserId,
  type MattermostApiFetch,
} from '../../../plugins/chat-provider-mattermost/file-helpers.js'
import { mockLogger } from '../../utils/test-helpers.js'

describe('file-helpers', () => {
  beforeEach(() => {
    mockLogger()
  })

  describe('resolveMattermostUserId', () => {
    test('returns user ID when API call succeeds', async () => {
      const mockFetch = mock((_method: string, _path: string, _body: unknown) =>
        Promise.resolve({ id: 'user-123', username: 'testuser' }),
      )

      const result = await resolveMattermostUserId('@testuser', mockFetch as MattermostApiFetch)
      expect(result).toBe('user-123')
      expect(mockFetch).toHaveBeenCalledWith('GET', '/api/v4/users/username/testuser', undefined)
    })

    test('returns null when API call fails', async () => {
      const mockFetch = mock(() => Promise.reject(new Error('Network error')))

      const result = await resolveMattermostUserId('unknown', mockFetch as MattermostApiFetch)
      expect(result).toBeNull()
    })

    test('returns null when response parsing fails', async () => {
      const mockFetch = mock(() => Promise.resolve({ invalid: 'data' }))

      const result = await resolveMattermostUserId('testuser', mockFetch as MattermostApiFetch)
      expect(result).toBeNull()
    })

    test('handles username without @ prefix', async () => {
      const mockFetch = mock((_method: string, _path: string, _body: unknown) =>
        Promise.resolve({ id: 'user-456', username: 'plainuser' }),
      )

      const result = await resolveMattermostUserId('plainuser', mockFetch as MattermostApiFetch)
      expect(result).toBe('user-456')
      expect(mockFetch).toHaveBeenCalledWith('GET', '/api/v4/users/username/plainuser', undefined)
    })

    test('strips @ prefix from username', async () => {
      const mockFetch = mock(() => Promise.resolve({ id: 'user-789', username: 'withat' }))

      await resolveMattermostUserId('@withat', mockFetch as MattermostApiFetch)
      expect(mockFetch).toHaveBeenCalledWith('GET', '/api/v4/users/username/withat', undefined)
    })
  })
})
