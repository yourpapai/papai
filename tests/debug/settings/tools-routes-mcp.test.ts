// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { ToolSet } from 'ai'
import { jsonSchema } from 'ai'
import { z } from 'zod'

import { toScopedContextId } from '../../../src/chat/scoped-context.js'
import { getToolPrefs } from '../../../src/tools/tool-preferences.js'
import { addUser } from '../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from './helpers.js'

const PLATFORM_INSTANCE_ID = 'pi-1'
const USER_ID = 'u-1'
const MCP_TOOL = 'mcp_search-server__fetch_page'

const buildMcpToolSetSpy = mock((_contextId: string): Promise<ToolSet> => Promise.resolve({}))
const buildPluginMcpToolSetSpy = mock(
  (_ids: string[], _desc: unknown, _pool: unknown): Promise<ToolSet> => Promise.resolve({}),
)

// The tools assembler imports { adaptMcpPool, buildMcpToolSet, buildPluginMcpToolSet }
// from src/mcp/index.js — all three must be provided by the mock.
void mock.module('../../../src/mcp/index.js', () => ({
  buildMcpToolSet: buildMcpToolSetSpy,
  buildPluginMcpToolSet: buildPluginMcpToolSetSpy,
  adaptMcpPool: mock(() => ({})),
}))

const { handleToolsRoutes } = await import('../../../src/debug/settings/tools-routes.js')

const DomainsResponseSchema = z.object({
  contextId: z.string(),
  domains: z.array(
    z.object({
      domain: z.string(),
      summary: z.string(),
      tools: z.array(z.object({ name: z.string(), permission: z.string(), group: z.string().optional() })),
    }),
  ),
})

describe('settings tools routes — MCP tools', () => {
  let session: SettingsSession
  let personalContextId: string

  beforeEach(async () => {
    mockLogger()
    void mock.module('../../../src/mcp/index.js', () => ({
      buildMcpToolSet: buildMcpToolSetSpy,
      buildPluginMcpToolSet: buildPluginMcpToolSetSpy,
      adaptMcpPool: mock(() => ({})),
    }))
    await setupTestDb()
    seedTestPlatformInstance({ id: PLATFORM_INSTANCE_ID })
    addUser({ userId: USER_ID, platformInstanceId: PLATFORM_INSTANCE_ID, addedBy: 'admin', username: undefined })
    session = await establishSession({ platformInstanceId: PLATFORM_INSTANCE_ID, platformUserId: USER_ID })
    personalContextId = toScopedContextId({ platformInstanceId: PLATFORM_INSTANCE_ID, nativeContextId: USER_ID })
    buildMcpToolSetSpy.mockClear()
    buildMcpToolSetSpy.mockResolvedValue({
      [MCP_TOOL]: {
        description: 'Fetch a page via MCP',
        inputSchema: jsonSchema({ type: 'object' as const, properties: {} }),
        execute: () => Promise.resolve('result'),
      },
    })
  })

  test('GET lists MCP tools under the mcp domain with the server id as group', async () => {
    const url = new URL('https://x/settings/api/tools')
    const res = await handleToolsRoutes(new Request(url, { headers: authHeaders(session) }), url, '/settings/api/tools')
    expect(res.status).toBe(200)
    const body = DomainsResponseSchema.parse(await res.json())
    const mcpDomain = body.domains.find((d) => d.domain === 'mcp')
    expect(mcpDomain).toBeDefined()
    expect(mcpDomain!.tools.map((t) => t.name)).toContain(MCP_TOOL)
    expect(mcpDomain!.tools[0]!.group).toBe('search-server')
  })

  test('toggle kind:tool on an MCP tool persists an override', async () => {
    const url = new URL('https://x/settings/api/tools/toggle')
    const res = await handleToolsRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'tool', tool: MCP_TOOL, permission: 'ask' }),
      }),
      url,
      '/settings/api/tools/toggle',
    )
    expect(res.status).toBe(200)
    expect(getToolPrefs(personalContextId).toolOverrides[MCP_TOOL]).toBe('ask')
  })

  test('toggle kind:group on an MCP server group persists overrides', async () => {
    const url = new URL('https://x/settings/api/tools/toggle')
    const res = await handleToolsRoutes(
      new Request(url, {
        method: 'POST',
        headers: { ...authHeaders(session, true), 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'group', domain: 'mcp', group: 'search-server', permission: 'deny' }),
      }),
      url,
      '/settings/api/tools/toggle',
    )
    expect(res.status).toBe(200)
    expect(getToolPrefs(personalContextId).toolOverrides[MCP_TOOL]).toBe('deny')
  })

  test('MCP build failure degrades to no MCP tools without erroring the route', async () => {
    buildMcpToolSetSpy.mockRejectedValueOnce(new Error('MCP connection failed'))
    const url = new URL('https://x/settings/api/tools')
    const res = await handleToolsRoutes(new Request(url, { headers: authHeaders(session) }), url, '/settings/api/tools')
    expect(res.status).toBe(200)
    const body = DomainsResponseSchema.parse(await res.json())
    expect(body.domains.find((d) => d.domain === 'mcp')).toBeUndefined()
  })
})
