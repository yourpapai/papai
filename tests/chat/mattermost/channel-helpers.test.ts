// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { checkChannelAdmin } from '../../../src/chat/mattermost/channel-helpers.js'

describe('channel-helpers', () => {
  describe('checkChannelAdmin', () => {
    it('should return true when user has channel_admin role', async () => {
      const apiFetch = (): Promise<unknown> => Promise.resolve({ roles: 'channel_admin system_user' })

      const result = await checkChannelAdmin('channel123', 'user456', apiFetch)

      expect(result).toBe(true)
    })

    it('should return false when user does not have channel_admin role', async () => {
      const apiFetch = (): Promise<unknown> => Promise.resolve({ roles: 'system_user' })

      const result = await checkChannelAdmin('channel123', 'user456', apiFetch)

      expect(result).toBe(false)
    })

    it('should return false on API error', async () => {
      const apiFetch = (): Promise<never> => Promise.reject(new Error('API Error'))

      const result = await checkChannelAdmin('channel123', 'user456', apiFetch)

      expect(result).toBe(false)
    })

    it('should return false on invalid response', async () => {
      const apiFetch = (): Promise<unknown> => Promise.resolve({ invalid: true })

      const result = await checkChannelAdmin('channel123', 'user456', apiFetch)

      expect(result).toBe(false)
    })
  })
})
