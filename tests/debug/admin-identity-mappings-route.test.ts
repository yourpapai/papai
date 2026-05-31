// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { z } from 'zod'

import { SESSION_COOKIE_NAME } from '../../src/dashboard-auth/cookie.js'
import { mintSession } from '../../src/dashboard-auth/index.js'
import { setStoreDb } from '../../src/dashboard-auth/store.js'
import { migration047DashboardSessions } from '../../src/db/migrations/047_dashboard_sessions.js'
import { routeRequestForTest } from '../../src/debug/server.js'
import { setIdentityMapping } from '../../src/identity/mapping.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const MappingEntrySchema = z.object({
  contextId: z.string(),
  providerName: z.string(),
  providerUserId: z.string().nullable(),
  providerUserLogin: z.string().nullable(),
  displayName: z.string().nullable(),
  matchedAt: z.string(),
  matchMethod: z.enum(['auto', 'manual_nl', 'unmatched']).nullable(),
  confidence: z.number().nullable(),
})

const MappingListSchema = z.array(MappingEntrySchema)

async function parsedMappings(cookieValue: string): Promise<z.infer<typeof MappingListSchema>> {
  const res = await routeRequestForTest(
    new Request('http://localhost/admin/identity/mappings', {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=${cookieValue}` },
    }),
  )
  expect(res.status).toBe(200)
  return MappingListSchema.parse(await res.json())
}

describe('GET /admin/identity/mappings', () => {
  let sessionDb: Database

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    sessionDb = new Database(':memory:')
    migration047DashboardSessions.up(sessionDb)
    setStoreDb(sessionDb)
  })

  afterEach(() => {
    sessionDb.close()
    setStoreDb(null)
  })

  test('returns 401 without a session cookie', async () => {
    const res = await routeRequestForTest(new Request('http://localhost/admin/identity/mappings'))
    expect(res.status).toBe(401)
  })

  test('returns empty array when no mappings exist', async () => {
    const { cookieValue } = mintSession('admin-1', { secure: false })
    const result = await parsedMappings(cookieValue)
    expect(result).toEqual([])
  })

  test('returns all seeded identity mappings', async () => {
    setIdentityMapping({
      contextId: 'ctx-alice',
      providerName: 'kaneo',
      providerUserId: 'k-1',
      providerUserLogin: 'alice',
      displayName: 'Alice',
      matchMethod: 'auto',
      confidence: 100,
    })
    setIdentityMapping({
      contextId: 'ctx-bob',
      providerName: 'youtrack',
      providerUserId: 'yt-2',
      providerUserLogin: 'bob',
      displayName: 'Bob',
      matchMethod: 'manual_nl',
      confidence: 80,
    })

    const { cookieValue } = mintSession('admin-1', { secure: false })
    const result = await parsedMappings(cookieValue)
    expect(result).toHaveLength(2)
    const contextIds = result.map((e) => e.contextId).sort((a, b) => a.localeCompare(b))
    expect(contextIds).toEqual(['ctx-alice', 'ctx-bob'])
  })

  test('each returned entry has the required IdentityMappingEntry fields', async () => {
    setIdentityMapping({
      contextId: 'ctx-charlie',
      providerName: 'kaneo',
      providerUserId: 'k-99',
      providerUserLogin: 'charlie',
      displayName: 'Charlie',
      matchMethod: 'auto',
      confidence: 95,
    })

    const { cookieValue } = mintSession('admin-1', { secure: false })
    const result = await parsedMappings(cookieValue)
    expect(result).toHaveLength(1)
    const entry = result[0]
    assert(entry !== undefined, 'expected one entry')
    expect(entry.contextId).toBe('ctx-charlie')
    expect(entry.providerName).toBe('kaneo')
    expect(entry.providerUserId).toBe('k-99')
    expect(entry.providerUserLogin).toBe('charlie')
    expect(entry.displayName).toBe('Charlie')
    expect(entry.matchMethod).toBe('auto')
    expect(entry.confidence).toBe(95)
    expect(typeof entry.matchedAt).toBe('string')
  })
})
