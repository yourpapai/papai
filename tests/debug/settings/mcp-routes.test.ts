// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { z } from 'zod'

import { getConfigValue } from '../../../src/config.js'
import { handleMcpRoutes } from '../../../src/debug/settings/mcp-routes.js'
import { addUser } from '../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from './helpers.js'

const PutResponseSchema = z.object({ contextId: z.string() })
const GetResponseSchema = z.object({
  endpoints: z.array(z.object({ headers: z.record(z.string(), z.string()).optional() })),
})

describe('settings mcp routes', () => {
  let session: SettingsSession

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'u-1', platformInstanceId: 'pi-1', addedBy: 'admin', username: undefined })
    session = await establishSession({ platformInstanceId: 'pi-1', platformUserId: 'u-1' })
  })

  test('PUT validates and persists endpoints; GET masks headers', async () => {
    const put = await handleMcpRoutes(
      new Request('https://x/settings/api/mcp', {
        method: 'PUT',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoints: [
            {
              id: 'srv1',
              url: 'https://mcp.example.com',
              enabled: true,
              headers: { Authorization: 'Bearer abcd1234' },
            },
          ],
        }),
      }),
      new URL('https://x/settings/api/mcp'),
    )
    expect(put.status).toBe(200)
    const putBody = PutResponseSchema.parse(await put.json())
    const stored = getConfigValue(putBody.contextId, 'mcp_endpoints')
    expect(stored).toContain('mcp.example.com')

    const get = await handleMcpRoutes(
      new Request('https://x/settings/api/mcp', { headers: authHeaders(session) }),
      new URL('https://x/settings/api/mcp'),
    )
    const body = GetResponseSchema.parse(await get.json())
    expect(body.endpoints[0]?.headers?.['Authorization']).not.toBe('Bearer abcd1234')
  })

  test('PUT rejects an http:// url with 422', async () => {
    const res = await handleMcpRoutes(
      new Request('https://x/settings/api/mcp', {
        method: 'PUT',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoints: [{ id: 'x', url: 'http://insecure.example.com', enabled: true }] }),
      }),
      new URL('https://x/settings/api/mcp'),
    )
    expect(res.status).toBe(422)
  })
})
