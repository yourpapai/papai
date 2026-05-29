// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { ActivitySchema } from '../../../../plugins/task-provider-youtrack/schemas/activity.js'

describe('ActivitySchema', () => {
  test('parses valid activity', () => {
    const data = {
      id: 'activity-1',
      timestamp: 1700000000000,
      author: {
        id: 'user-1',
        login: 'alice',
        fullName: 'Alice Example',
      },
      category: { id: 'SprintCategory' },
      field: { name: 'Sprint' },
      targetMember: 'Sprint',
      added: [{ name: 'Sprint 1' }],
      removed: { text: 'Backlog' },
    }

    expect(ActivitySchema.parse(data)).toEqual(data)
  })

  test('allows optional author and category fields to be omitted', () => {
    expect(ActivitySchema.parse({ id: 'activity-1', timestamp: 1700000000000 })).toEqual({
      id: 'activity-1',
      timestamp: 1700000000000,
    })
  })

  test('rejects missing timestamp', () => {
    expect(() => ActivitySchema.parse({ id: 'activity-1' })).toThrow()
  })
})
