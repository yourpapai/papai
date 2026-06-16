// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { CONTEXT_OWNED_COLUMNS } from '../../../src/db/migrations/scoped-context-owned-columns.js'

const webRateLimitEntry = CONTEXT_OWNED_COLUMNS.find((c) => c.table === 'web_rate_limit' && c.column === 'actor_id')

describe('CONTEXT_OWNED_COLUMNS', () => {
  test('web_rate_limit.actor_id entry exists', () => {
    expect(webRateLimitEntry).toBeDefined()
  })

  test('web_rate_limit.actor_id is not threadScoped (it stores chatUserId, not a thread context id)', () => {
    expect(webRateLimitEntry!.threadScoped).toBe(false)
  })
})
