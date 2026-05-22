// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { RecentRequestSchema, RecentRequestsResponseSchema } from '../../src/debug/admin-schemas.js'

const validRow = {
  ts: 1000,
  modelLabel: 'gpt-4o',
  role: 'main',
  inputTokens: 100,
  outputTokens: 50,
  finishStatus: 'stop',
}

describe('admin-schemas', () => {
  test('RecentRequestSchema rejects negative ts', () => {
    const result = RecentRequestSchema.safeParse({ ...validRow, ts: -1 })
    expect(result.success).toBe(false)
  })

  test('RecentRequestSchema accepts a valid row', () => {
    const result = RecentRequestSchema.safeParse(validRow)
    expect(result.success).toBe(true)
  })

  test('RecentRequestsResponseSchema validates the full response shape', () => {
    const result = RecentRequestsResponseSchema.safeParse({
      subjectId: 'user:1',
      limit: 25,
      requests: [validRow],
    })
    expect(result.success).toBe(true)
  })

  test('RecentRequestSchema parsed row has only the 6 anonymous fields', () => {
    const result = RecentRequestSchema.parse(validRow)
    expect(Object.keys(result).sort()).toEqual([
      'finishStatus',
      'inputTokens',
      'modelLabel',
      'outputTokens',
      'role',
      'ts',
    ])
  })
})
