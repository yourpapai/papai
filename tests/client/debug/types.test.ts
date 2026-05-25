// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { SessionDetail } from '../../../client/debug/types.js'

describe('dashboard-ui types', () => {
  test('SessionDetail type accepts all required fields', () => {
    const session: SessionDetail = {
      userId: 'test-user',
      lastAccessed: Date.now(),
      historyLength: 5,
      factsCount: 2,
      summary: 'Test summary',
      configKeys: ['key1', 'key2'],
      workspaceId: 'ws-1',
      hasTools: true,
      instructionsCount: 3,
      facts: [
        {
          identifier: 'fact-1',
          title: 'Fact 1',
          url: 'http://example.com',
          lastSeen: '2024-01-01',
        },
      ],
      config: { key1: 'value1' },
      instructions: [{ id: 'inst-1', text: 'Be helpful', createdAt: '2024-01-01' }],
      history: [{ role: 'user', content: 'Hello' }],
    }

    expect(session.userId).toBe('test-user')
    expect(session.historyLength).toBe(5)
  })
})
