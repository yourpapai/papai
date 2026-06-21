// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { shouldBackstopGroupMembership } from '../src/llm-orchestrator-membership.js'

describe('shouldBackstopGroupMembership', () => {
  test('returns true for a member in a group context', () => {
    expect(shouldBackstopGroupMembership('group', 'member')).toBe(true)
  })

  test('returns false for a guest in a group context', () => {
    expect(shouldBackstopGroupMembership('group', 'guest')).toBe(false)
  })

  test('returns false for a member in a dm context', () => {
    expect(shouldBackstopGroupMembership('dm', 'member')).toBe(false)
  })

  test('returns false for a guest in a dm context', () => {
    expect(shouldBackstopGroupMembership('dm', 'guest')).toBe(false)
  })

  test('returns true for undefined actorRole (defaults to member) in a group context', () => {
    expect(shouldBackstopGroupMembership('group', undefined)).toBe(true)
  })
})
