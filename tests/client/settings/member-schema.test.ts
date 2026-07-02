// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { GroupMembersResponseSchema } from '../../../client/settings/fetcher-schemas.js'

describe('GroupMembersResponseSchema label fields', () => {
  test('accepts members with label fields', () => {
    const parsed = GroupMembersResponseSchema.parse({
      contextId: 'c1',
      members: [{ user_id: '42', added_by: '1', added_at: 't', user_label: 'Ann', added_by_label: 'Admin' }],
    })
    expect(parsed.members[0]!.user_label).toBe('Ann')
    expect(parsed.members[0]!.added_by_label).toBe('Admin')
  })

  test('accepts members without label fields (backward compatible)', () => {
    const parsed = GroupMembersResponseSchema.parse({
      contextId: 'c1',
      members: [{ user_id: '42', added_by: '1', added_at: 't' }],
    })
    expect(parsed.members[0]!.user_label).toBeUndefined()
  })
})
