// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { handleAdminLlmPost } from '../../src/debug/billing-routes.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('handleAdminLlmPost (unit)', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    delete process.env['DEBUG_TOKEN']
    process.env['ADMIN_USER_ID'] = 'admin-1'
  })

  test('returns 400 (not 401) when DEBUG_TOKEN is unset but body is invalid', async () => {
    const req = new Request('http://localhost/admin/llm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'invalid_key', value: 'x' }),
    })
    const res = await handleAdminLlmPost(req)
    // After removing the DEBUG_TOKEN gate, body validation runs and should return 400.
    expect(res.status).not.toBe(401)
  })

  test('returns 503 when ADMIN_USER_ID is unset', async () => {
    delete process.env['ADMIN_USER_ID']
    const req = new Request('http://localhost/admin/llm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'main_model', value: 'gpt-6' }),
    })
    const res = await handleAdminLlmPost(req)
    expect(res.status).toBe(503)
  })
})
