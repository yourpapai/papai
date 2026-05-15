// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { Fact, Instruction, Session } from '../../../client/debug/dashboard-types.js'

describe('dashboard-types', () => {
  test('Fact type is usable', () => {
    const fact: Fact = {
      identifier: 'test-123',
      title: 'Test Fact',
      url: 'https://example.com',
      lastSeen: '2024-01-15T10:30:00.000Z',
    }
    expect(fact.identifier).toBe('test-123')
  })

  test('Instruction type is usable', () => {
    const instruction: Instruction = {
      id: 'inst-1',
      text: 'Be helpful',
      createdAt: '2024-01-15T10:00:00.000Z',
    }
    expect(instruction.text).toBe('Be helpful')
  })

  test('Session type includes full data fields', () => {
    const session: Session = {
      userId: 'user-123',
      lastAccessed: Date.now(),
      historyLength: 5,
      factsCount: 2,
      summary: 'Test summary',
      configKeys: ['key1'],
      workspaceId: 'ws-123',
      facts: [
        {
          identifier: 'fact-1',
          title: 'Fact One',
          url: 'https://example.com/fact',
          lastSeen: '2024-01-15T10:30:00.000Z',
        },
      ],
      config: { key1: 'value1' },
      hasTools: true,
      instructionsCount: 1,
      instructions: [{ id: 'inst-1', text: 'Be helpful', createdAt: '2024-01-15T10:00:00.000Z' }],
    }
    expect(session.userId).toBe('user-123')
    expect(session.facts).toHaveLength(1)
  })
})
