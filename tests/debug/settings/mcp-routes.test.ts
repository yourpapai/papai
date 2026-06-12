// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { z } from 'zod'

import { getConfigValue } from '../../../src/config.js'
import { handleMcpRoutes } from '../../../src/debug/settings/mcp-routes.js'
import { addUser } from '../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from './helpers.js'

const PutResponseSchema = z.object({ contextId: z.string() })
const GetResponseSchema = z.object({
  endpoints: z.array(
    z.object({
      headers: z.record(z.string(), z.string()).optional(),
      toolFilter: z.object({ allow: z.array(z.string()).optional(), deny: z.array(z.string()).optional() }).optional(),
    }),
  ),
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
    expect(body.endpoints[0]?.headers?.['Authorization']).toBe('****1234')
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

  test('PUT with a masked header value does not overwrite the stored plaintext secret', async () => {
    // Step 1: store plaintext via initial PUT
    const put1 = await handleMcpRoutes(
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
    expect(put1.status).toBe(200)
    const put1Body = PutResponseSchema.parse(await put1.json())
    const contextId = put1Body.contextId

    // Step 2: GET to obtain the masked header value
    const get = await handleMcpRoutes(
      new Request('https://x/settings/api/mcp', { headers: authHeaders(session) }),
      new URL('https://x/settings/api/mcp'),
    )
    const getBody = GetResponseSchema.parse(await get.json())
    const maskedAuth = getBody.endpoints[0]?.headers?.['Authorization']
    assert(maskedAuth !== undefined, 'expected masked Authorization header')
    expect(maskedAuth).toBe('****1234')

    // Step 3: PUT the same endpoint back with the masked value (simulating a client that did not change the secret)
    const put2 = await handleMcpRoutes(
      new Request('https://x/settings/api/mcp', {
        method: 'PUT',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoints: [
            {
              id: 'srv1',
              url: 'https://mcp.example.com',
              enabled: true,
              headers: { Authorization: maskedAuth },
            },
          ],
        }),
      }),
      new URL('https://x/settings/api/mcp'),
    )
    expect(put2.status).toBe(200)

    // Step 4: Assert stored config still contains the original plaintext secret
    expect(getConfigValue(contextId, 'mcp_endpoints')).toContain('Bearer abcd1234')
  })

  test('PUT with a changed header value persists the new plaintext', async () => {
    // Store original value first
    const put1 = await handleMcpRoutes(
      new Request('https://x/settings/api/mcp', {
        method: 'PUT',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoints: [
            {
              id: 'srv1',
              url: 'https://mcp.example.com',
              enabled: true,
              headers: { Authorization: 'Bearer original-secret' },
            },
          ],
        }),
      }),
      new URL('https://x/settings/api/mcp'),
    )
    expect(put1.status).toBe(200)
    const put1Body = PutResponseSchema.parse(await put1.json())
    const contextId = put1Body.contextId
    expect(getConfigValue(contextId, 'mcp_endpoints')).toContain('Bearer original-secret')

    // Now update with a new plaintext value (not the masked form)
    const put2 = await handleMcpRoutes(
      new Request('https://x/settings/api/mcp', {
        method: 'PUT',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoints: [
            {
              id: 'srv1',
              url: 'https://mcp.example.com',
              enabled: true,
              headers: { Authorization: 'Bearer new-secret' },
            },
          ],
        }),
      }),
      new URL('https://x/settings/api/mcp'),
    )
    expect(put2.status).toBe(200)

    // Stored value should now be the new secret
    const stored = getConfigValue(contextId, 'mcp_endpoints')
    expect(stored).toContain('Bearer new-secret')
    expect(stored).not.toContain('Bearer original-secret')
  })

  test('PUT with toolFilter persists and GET returns it', async () => {
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
              toolFilter: { allow: ['tool_a', 'tool_b'], deny: ['tool_c'] },
            },
          ],
        }),
      }),
      new URL('https://x/settings/api/mcp'),
    )
    expect(put.status).toBe(200)
    const putBody = PutResponseSchema.parse(await put.json())
    const contextId = putBody.contextId

    // Stored config should contain toolFilter data
    const stored = getConfigValue(contextId, 'mcp_endpoints')
    expect(stored).toContain('tool_a')
    expect(stored).toContain('tool_c')

    // GET should return the toolFilter
    const get = await handleMcpRoutes(
      new Request('https://x/settings/api/mcp', { headers: authHeaders(session) }),
      new URL('https://x/settings/api/mcp'),
    )
    expect(get.status).toBe(200)
    const body = GetResponseSchema.parse(await get.json())
    expect(body.endpoints[0]?.toolFilter?.allow).toEqual(['tool_a', 'tool_b'])
    expect(body.endpoints[0]?.toolFilter?.deny).toEqual(['tool_c'])
  })
})
