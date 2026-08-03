// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { formatScope } from '../../../client/debug/scope-label.js'

describe('formatScope', () => {
  test('user scope renders dm label', () => {
    expect(formatScope({ kind: 'user', userId: 'tg:1001' })).toBe('dm:tg:1001')
    expect(formatScope({ kind: 'user' })).toBe('dm')
  })

  test('group scope renders group label with optional thread', () => {
    expect(formatScope({ kind: 'group', groupId: 'g1' })).toBe('group:g1')
    expect(formatScope({ kind: 'group', groupId: 'g1', threadId: 'th7' })).toBe('group:g1/th7')
    expect(formatScope({ kind: 'group' })).toBe('group')
  })

  test('global scope renders global', () => {
    expect(formatScope({ kind: 'global' })).toBe('global')
  })
})
