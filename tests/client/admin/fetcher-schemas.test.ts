// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { RecentRequestRowSchema, RecentRequestsResponseSchema } from '../../../client/admin/fetcher-schemas.js'

describe('RecentRequestRowSchema', () => {
  test('accepts a valid recent request row', () => {
    const row = {
      ts: 1_700_000_000_000,
      modelLabel: 'gpt-4o',
      role: 'main',
      inputTokens: 100,
      outputTokens: 200,
      finishStatus: 'stop',
    }
    const result = RecentRequestRowSchema.safeParse(row)
    expect(result.success).toBe(true)
  })

  test('rejects a row missing required fields', () => {
    const result = RecentRequestRowSchema.safeParse({ ts: 1_700_000_000_000 })
    expect(result.success).toBe(false)
  })
})

describe('RecentRequestsResponseSchema', () => {
  test('accepts a valid response with requests', () => {
    const body = {
      subjectId: 'user-A',
      limit: 25,
      requests: [
        {
          ts: 1_700_000_000_000,
          modelLabel: 'gpt-4o',
          role: 'main',
          inputTokens: 100,
          outputTokens: 200,
          finishStatus: 'stop',
        },
      ],
    }
    const parsed = RecentRequestsResponseSchema.parse(body)
    expect(parsed.requests).toHaveLength(1)
    expect(parsed.requests[0]?.modelLabel).toBe('gpt-4o')
  })

  test('accepts a valid response with empty requests', () => {
    const body = { subjectId: 'user-B', limit: 25, requests: [] }
    const result = RecentRequestsResponseSchema.safeParse(body)
    expect(result.success).toBe(true)
  })

  test('rejects a response missing subjectId', () => {
    const result = RecentRequestsResponseSchema.safeParse({ limit: 25, requests: [] })
    expect(result.success).toBe(false)
  })
})
