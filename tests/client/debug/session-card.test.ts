// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { buildSessionCard } from '../../../client/debug/session-card.js'
import type { SessionDetail } from '../../../client/debug/types.js'

describe('buildSessionCard', () => {
  it('should build session card HTML', () => {
    const session: SessionDetail = {
      userId: 'user-123',
      historyLength: 10,
      factsCount: 5,
      summary: 'Test summary',
      lastAccessed: Date.now(),
      configKeys: ['key1', 'key2'],
      workspaceId: 'ws-123',
    }
    const wizards = new Map<string, { currentStep: number; totalSteps: number }>()

    const html = buildSessionCard('user-123', session, wizards)

    expect(html).toContain('user-123')
    expect(html).toContain('history: 10')
    expect(html).toContain('facts: 5')
    expect(html).toContain('config: 2 keys')
    expect(html).toContain('workspace: ws-123')
  })

  it('should mark active sessions', () => {
    const session: SessionDetail = {
      userId: 'user-1',
      historyLength: 0,
      factsCount: 0,
      summary: null,
      // recent access
      lastAccessed: Date.now(),
      configKeys: [],
      workspaceId: null,
    }
    const wizards = new Map<string, { currentStep: number; totalSteps: number }>()

    const html = buildSessionCard('user-1', session, wizards)

    expect(html).toContain('session-card active')
  })

  it('should include wizard badge when active', () => {
    const session: SessionDetail = {
      userId: 'user-1',
      historyLength: 0,
      factsCount: 0,
      summary: null,
      lastAccessed: Date.now(),
      configKeys: [],
      workspaceId: null,
    }
    const wizards = new Map<string, { currentStep: number; totalSteps: number }>([
      ['user-1', { currentStep: 2, totalSteps: 5 }],
    ])

    const html = buildSessionCard('user-1', session, wizards)

    expect(html).toContain('wizard step 2/5')
  })
})
