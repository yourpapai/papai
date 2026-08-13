// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { z } from 'zod'

import { createToken } from '../../src/context-vault/token-store.js'
import { routeRequestForTest } from '../../src/debug/server.testing.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const CTX = 'pi:telegram:grp:push'

const validBody = (): string =>
  JSON.stringify({
    repo: 'papai',
    changeName: 'context-vault-plugin',
    files: [{ path: 'a/proposal.md', kind: 'proposal', hash: 'h1', mtime: 1710000000000, text: '# P\n' }],
    deletions: [],
  })

const PushResponseSchema = z.object({ ok: z.literal(true), specId: z.string() })

const pushReq = (token: string | null): Request => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token !== null) headers['Authorization'] = `Bearer ${token}`
  return new Request('http://x/api/context-vault/push', { method: 'POST', headers, body: validBody() })
}

describe('/api/context-vault/push routing', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('is handled by the vault route (JSON 401), not the dashboard 401, when debug is disabled', async () => {
    const res = await routeRequestForTest(pushReq(null), { debugEnabled: false })
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthorized' })
  })

  test('accepts a valid vault token push when debug is disabled', async () => {
    const created = createToken(CTX, 'indexer')
    const res = await routeRequestForTest(pushReq(created.plaintext), { debugEnabled: false })
    expect(res.status).toBe(200)
    const body = PushResponseSchema.parse(await res.json())
    expect(body.ok).toBe(true)
    expect(body.specId).toBe('papai:context-vault-plugin')
  })
})
