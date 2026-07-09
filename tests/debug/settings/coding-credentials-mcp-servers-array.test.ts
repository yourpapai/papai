// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { z } from 'zod'

import { setCodingGuardrails } from '../../../src/coding-credentials/guardrails.js'
import { parseMcpSelections } from '../../../src/coding-credentials/mcp-selections.js'
import { getCodingCredentials } from '../../../src/coding-credentials/store.js'
import { handleCodingCredentialsRoutes } from '../../../src/debug/settings/coding-credentials-routes.js'
import { resolveSettingsPrincipal } from '../../../src/settings/principal.js'
import { addUser } from '../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from './helpers.js'

const PLATFORM_INSTANCE_ID = 'pi-coding-mcp-array'
const USER_ID = 'u-coding-mcp-array-1'

const GetResponseSchema = z.looseObject({
  namespace: z.string(),
  maxMcpServers: z.number().optional(),
  fields: z.array(z.object({ key: z.string(), value: z.string() })),
})

const PatchResponseSchema = z.object({ ok: z.literal(true), contextId: z.string() })
const ErrorResponseSchema = z.object({ error: z.string() })

function get(path: string, session: SettingsSession): Request {
  return new Request(`https://x${path}`, { headers: authHeaders(session) })
}

function patch(path: string, session: SettingsSession, body: unknown): Request {
  return new Request(`https://x${path}`, {
    method: 'PATCH',
    headers: {
      ...authHeaders(session, true),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

describe('coding-credentials mcp servers[] array', () => {
  let session: SettingsSession
  let personalConfigContextId: string

  beforeEach(async () => {
    mockLogger()
    process.env['INSTANCE_CONFIG_KEY'] = 'e'.repeat(64)
    await setupTestDb()
    seedTestPlatformInstance({ id: PLATFORM_INSTANCE_ID })
    addUser({
      userId: USER_ID,
      platformInstanceId: PLATFORM_INSTANCE_ID,
      addedBy: 'admin',
      username: undefined,
    })
    session = await establishSession({
      platformInstanceId: PLATFORM_INSTANCE_ID,
      platformUserId: USER_ID,
    })
    personalConfigContextId = resolveSettingsPrincipal(PLATFORM_INSTANCE_ID, USER_ID).personalConfigContextId
  })

  test('GET ?namespace=mcp includes maxMcpServers matching the guardrail', async () => {
    setCodingGuardrails(PLATFORM_INSTANCE_ID, {
      allowedAgents: ['claude', 'codex', 'opencode'],
      whoMayUse: 'members',
      forceSharedKey: false,
      maxMcpServers: 5,
    })
    const url = new URL(`https://x/settings/api/coding-credentials?contextId=${personalConfigContextId}&namespace=mcp`)
    const res = await handleCodingCredentialsRoutes(
      get(`/settings/api/coding-credentials?contextId=${personalConfigContextId}&namespace=mcp`, session),
      url,
    )
    expect(res.status).toBe(200)
    const body = GetResponseSchema.parse(await res.json())
    expect(body.maxMcpServers).toBe(5)
  })

  test('PATCH with a valid servers array (count <= cap) persists and canonicalizes; tokens stay server-side', async () => {
    const selections = [{ server: 'github', upstream_token: 'mcp-secret-token' }, { server: 'plugin:web-search' }]
    const url = new URL('https://x/settings/api/coding-credentials')
    const patchRes = await handleCodingCredentialsRoutes(
      patch('/settings/api/coding-credentials', session, {
        namespace: 'mcp',
        values: { servers: JSON.stringify(selections) },
      }),
      url,
    )
    expect(patchRes.status).toBe(200)
    const patchBody = PatchResponseSchema.parse(await patchRes.json())
    expect(patchBody.contextId).toBe(personalConfigContextId)

    const stored = getCodingCredentials(personalConfigContextId, 'mcp')
    expect(parseMcpSelections(stored)).toEqual(selections)

    const getUrl = new URL(
      `https://x/settings/api/coding-credentials?contextId=${personalConfigContextId}&namespace=mcp`,
    )
    const getRes = await handleCodingCredentialsRoutes(
      get(`/settings/api/coding-credentials?contextId=${personalConfigContextId}&namespace=mcp`, session),
      getUrl,
    )
    expect(getRes.status).toBe(200)
    const text = await getRes.text()
    expect(text).not.toContain('mcp-secret-token')
    const body = GetResponseSchema.parse(JSON.parse(text))
    const serversField = body.fields.find((f) => f.key === 'servers')
    expect(serversField?.value).not.toContain('mcp-secret-token')
  })

  test('PATCH exceeding the operator cap returns 422', async () => {
    setCodingGuardrails(PLATFORM_INSTANCE_ID, {
      allowedAgents: ['claude', 'codex', 'opencode'],
      whoMayUse: 'members',
      forceSharedKey: false,
      maxMcpServers: 1,
    })
    const url = new URL('https://x/settings/api/coding-credentials')
    const res = await handleCodingCredentialsRoutes(
      patch('/settings/api/coding-credentials', session, {
        namespace: 'mcp',
        values: {
          servers: JSON.stringify([{ server: 'github', upstream_token: 't1' }, { server: 'plugin:web-search' }]),
        },
      }),
      url,
    )
    expect(res.status).toBe(422)
    const body = ErrorResponseSchema.parse(await res.json())
    expect(body.error).toContain('too many')
  })

  test('PATCH with malformed servers JSON returns 422', async () => {
    const url = new URL('https://x/settings/api/coding-credentials')
    const res = await handleCodingCredentialsRoutes(
      patch('/settings/api/coding-credentials', session, {
        namespace: 'mcp',
        values: { servers: 'not json' },
      }),
      url,
    )
    expect(res.status).toBe(422)
    const body = ErrorResponseSchema.parse(await res.json())
    expect(body.error).toContain('invalid')
  })

  test('PATCH with a well-formed but schema-invalid servers array returns 422', async () => {
    const url = new URL('https://x/settings/api/coding-credentials')
    const res = await handleCodingCredentialsRoutes(
      patch('/settings/api/coding-credentials', session, {
        namespace: 'mcp',
        values: { servers: JSON.stringify([{ server: '' }]) },
      }),
      url,
    )
    expect(res.status).toBe(422)
    const body = ErrorResponseSchema.parse(await res.json())
    expect(body.error).toContain('invalid')
  })
})
