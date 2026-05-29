// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { SprintSchema } from '../../../../plugins/task-provider-youtrack/schemas/sprint.js'

describe('SprintSchema', () => {
  test('parses valid sprint with all fields', () => {
    const data = {
      id: 'sprint-1',
      name: 'Sprint 1',
      archived: true,
      goal: 'Ship Phase 5',
      isDefault: true,
      start: 1700000000000,
      finish: 1700600000000,
      unresolvedIssuesCount: 4,
    }

    expect(SprintSchema.parse(data)).toEqual(data)
  })

  test('defaults archived to false when omitted', () => {
    const result = SprintSchema.parse({ id: 'sprint-1', name: 'Sprint 1' })

    expect(result.archived).toBe(false)
  })

  test('rejects invalid start timestamp', () => {
    expect(() => SprintSchema.parse({ id: 'sprint-1', name: 'Sprint 1', start: 'today' })).toThrow()
  })
})
