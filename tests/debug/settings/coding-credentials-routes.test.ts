// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { z } from 'zod'

import { maskSensitiveValue } from '../../../src/config.js'
import { handleCodingCredentialsRoutes } from '../../../src/debug/settings/coding-credentials-routes.js'
import { setMcpCatalog } from '../../../src/modules/coding/credentials/mcp-catalog.js'
import { getCodingCredentials } from '../../../src/modules/coding/credentials/store.js'
import { resolveSettingsPrincipal } from '../../../src/settings/principal.js'
import { addUser } from '../../../src/users.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from './helpers.js'

const PLATFORM_INSTANCE_ID = 'pi-coding'
const USER_ID = 'u-coding-1'

const FieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  required: z.boolean(),
  sensitive: z.boolean(),
  hasValue: z.boolean(),
  value: z.string(),
  control: z.enum(['select', 'combobox']).optional(),
  options: z.array(z.string()).optional(),
})

const GetResponseSchema = z.object({
  namespace: z.string(),
  configured: z.boolean(),
  complete: z.boolean(),
  missing: z.array(z.string()),
  unreadable: z.literal(true).optional(),
  error: z.string().optional(),
  fields: z.array(FieldSchema),
  allowedAgents: z.array(z.string()).optional(),
  catalog: z
    .array(
      z.object({
        name: z.string(),
        upstream_url: z.string(),
        header: z.string().optional(),
        default_tool_policy: z.enum(['allow', 'ask', 'deny']),
        tool_policy: z.record(z.string(), z.enum(['allow', 'ask', 'deny'])).optional(),
      }),
    )
    .optional(),
})

const PatchResponseSchema = z.object({
  ok: z.literal(true),
  contextId: z.string(),
})

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

describe('coding-credentials routes', () => {
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

  test('GET returns not-configured fields without secret values', async () => {
    const url = new URL('https://x/settings/api/coding-credentials')
    const res = await handleCodingCredentialsRoutes(get('/settings/api/coding-credentials', session), url)
    expect(res.status).toBe(200)
    const body = GetResponseSchema.parse(await res.json())
    expect(body.configured).toBe(false)
    expect(body.fields.map((f) => f.key)).toEqual([
      'agent',
      'provider',
      'auth_method',
      'provider_api_key',
      'provider_base_url',
      'model',
    ])
    for (const field of body.fields) {
      expect(field.value).toBe('')
    }
  })

  test('GET returns select metadata for agent and provider fields', async () => {
    const url = new URL('https://x/settings/api/coding-credentials')
    const res = await handleCodingCredentialsRoutes(get('/settings/api/coding-credentials', session), url)
    expect(res.status).toBe(200)
    const body = GetResponseSchema.parse(await res.json())
    const agentField = body.fields.find((f) => f.key === 'agent')
    const providerField = body.fields.find((f) => f.key === 'provider')
    expect(agentField?.control).toBe('select')
    expect(Array.isArray(agentField?.options)).toBe(true)
    expect(providerField?.control).toBe('select')
    expect(Array.isArray(providerField?.options)).toBe(true)
  })

  test('PATCH rejects incompatible agent/provider pair with 422', async () => {
    const url = new URL('https://x/settings/api/coding-credentials')
    const res = await handleCodingCredentialsRoutes(
      patch('/settings/api/coding-credentials', session, {
        namespace: 'agent-provider',
        values: { agent: 'claude', provider: 'openai', provider_api_key: 'x' },
      }),
      url,
    )
    expect(res.status).toBe(422)
    const body = ErrorResponseSchema.parse(await res.json())
    expect(body.error).toContain('incompatible')
  })

  test('PATCH accepts compatible agent/provider pair', async () => {
    const url = new URL('https://x/settings/api/coding-credentials')
    const res = await handleCodingCredentialsRoutes(
      patch('/settings/api/coding-credentials', session, {
        namespace: 'agent-provider',
        values: { agent: 'claude', provider: 'anthropic', provider_api_key: 'sk-ant-good' },
      }),
      url,
    )
    expect(res.status).toBe(200)
  })

  test('PATCH saves the key and GET reports configured (complete when all required fields set)', async () => {
    const secret = 'sk-ant-1234'
    const patchUrl = new URL('https://x/settings/api/coding-credentials')
    const patchRes = await handleCodingCredentialsRoutes(
      patch('/settings/api/coding-credentials', session, {
        values: { agent: 'claude', provider: 'anthropic', provider_api_key: secret },
      }),
      patchUrl,
    )
    expect(patchRes.status).toBe(200)
    const patchBody = PatchResponseSchema.parse(await patchRes.json())
    expect(patchBody.ok).toBe(true)
    expect(patchBody.contextId).toBe(personalConfigContextId)

    const getUrl = new URL('https://x/settings/api/coding-credentials')
    const getRes = await handleCodingCredentialsRoutes(get('/settings/api/coding-credentials', session), getUrl)
    expect(getRes.status).toBe(200)
    const text = await getRes.text()
    expect(text).not.toContain(secret)
    const getBody = GetResponseSchema.parse(JSON.parse(text))
    expect(getBody.configured).toBe(true)
    expect(getBody.complete).toBe(true)
    const keyField = getBody.fields.find((f) => f.key === 'provider_api_key')
    expect(keyField?.value).not.toContain(secret)
    expect(keyField?.value.length).toBeGreaterThan(0)
  })

  test('PATCH with clear:true removes credentials', async () => {
    const patchUrl = new URL('https://x/settings/api/coding-credentials')
    await handleCodingCredentialsRoutes(
      patch('/settings/api/coding-credentials', session, {
        values: { provider_api_key: 'sk-1' },
      }),
      patchUrl,
    )
    await handleCodingCredentialsRoutes(patch('/settings/api/coding-credentials', session, { clear: true }), patchUrl)
    const getUrl = new URL('https://x/settings/api/coding-credentials')
    const res = await handleCodingCredentialsRoutes(get('/settings/api/coding-credentials', session), getUrl)
    expect(res.status).toBe(200)
    const body = GetResponseSchema.parse(await res.json())
    expect(body.configured).toBe(false)
  })

  test('PATCH to an unmanageable context is forbidden', async () => {
    const url = new URL('https://x/settings/api/coding-credentials')
    const res = await handleCodingCredentialsRoutes(
      patch('/settings/api/coding-credentials', session, {
        contextId: 'pi:telegram:ctx:stranger',
        values: { provider_api_key: 'x' },
      }),
      url,
    )
    expect(res.status).toBe(403)
  })

  test('malformed body is rejected with 422', async () => {
    const url = new URL('https://x/settings/api/coding-credentials')
    const res = await handleCodingCredentialsRoutes(
      patch('/settings/api/coding-credentials', session, { bogus: 1 }),
      url,
    )
    expect(res.status).toBe(422)
    const body = ErrorResponseSchema.parse(await res.json())
    expect(body.error).toBe('invalid request')
  })

  test('unauthenticated request returns 401', async () => {
    const url = new URL('https://x/settings/api/coding-credentials')
    const res = await handleCodingCredentialsRoutes(new Request(url), url)
    expect(res.status).toBe(401)
  })

  test('unsupported method returns 405', async () => {
    const url = new URL('https://x/settings/api/coding-credentials')
    const res = await handleCodingCredentialsRoutes(
      new Request(url, { method: 'POST', headers: authHeaders(session) }),
      url,
    )
    expect(res.status).toBe(405)
  })

  test('PATCH preserves existing api key when client submits masked value', async () => {
    const secret = 'sk-ant-original-9999'
    const url = new URL('https://x/settings/api/coding-credentials')

    await handleCodingCredentialsRoutes(
      patch('/settings/api/coding-credentials', session, {
        values: { agent: 'claude', provider: 'anthropic', provider_api_key: secret },
      }),
      url,
    )

    const patchRes = await handleCodingCredentialsRoutes(
      patch('/settings/api/coding-credentials', session, {
        values: {
          agent: 'claude',
          provider: 'anthropic',
          provider_api_key: maskSensitiveValue(secret),
          provider_base_url: 'https://new.example',
        },
      }),
      url,
    )
    expect(patchRes.status).toBe(200)

    const stored = getCodingCredentials(personalConfigContextId, 'agent-provider')
    expect(stored?.provider_api_key).toBe(secret)
    expect(stored?.provider_base_url).toBe('https://new.example')
  })

  test('PATCH clears optional field when client submits blank value', async () => {
    const secret = 'sk-ant-keep-me-7777'
    const url = new URL('https://x/settings/api/coding-credentials')

    await handleCodingCredentialsRoutes(
      patch('/settings/api/coding-credentials', session, {
        values: {
          agent: 'claude',
          provider: 'anthropic',
          provider_api_key: secret,
          provider_base_url: 'https://old.example',
        },
      }),
      url,
    )

    const patchRes = await handleCodingCredentialsRoutes(
      patch('/settings/api/coding-credentials', session, {
        values: { provider_base_url: '' },
      }),
      url,
    )
    expect(patchRes.status).toBe(200)

    const stored = getCodingCredentials(personalConfigContextId, 'agent-provider')
    expect(stored?.provider_api_key).toBe(secret)
    expect(stored?.provider_base_url).toBeUndefined()
  })

  test('GET ?namespace=forge returns forge fields; default stays agent-provider', async () => {
    const forgeUrl = new URL(
      `https://x/settings/api/coding-credentials?contextId=${personalConfigContextId}&namespace=forge`,
    )
    const forge = await handleCodingCredentialsRoutes(
      get(`/settings/api/coding-credentials?contextId=${personalConfigContextId}&namespace=forge`, session),
      forgeUrl,
    )
    expect(forge.status).toBe(200)
    const forgeBody = GetResponseSchema.parse(await forge.json())
    expect(forgeBody.fields.map((f) => f.key)).toEqual(['kind', 'instance_url', 'forge_token'])

    const dfltUrl = new URL(`https://x/settings/api/coding-credentials?contextId=${personalConfigContextId}`)
    const dflt = await handleCodingCredentialsRoutes(
      get(`/settings/api/coding-credentials?contextId=${personalConfigContextId}`, session),
      dfltUrl,
    )
    expect(dflt.status).toBe(200)
    const dfltBody = GetResponseSchema.parse(await dflt.json())
    expect(dfltBody.fields.map((f) => f.key)).toEqual([
      'agent',
      'provider',
      'auth_method',
      'provider_api_key',
      'provider_base_url',
      'model',
    ])
  })

  test('GET ?namespace=mcp returns mcp field metadata with user-facing labels', async () => {
    const url = new URL(`https://x/settings/api/coding-credentials?contextId=${personalConfigContextId}&namespace=mcp`)
    const res = await handleCodingCredentialsRoutes(
      get(`/settings/api/coding-credentials?contextId=${personalConfigContextId}&namespace=mcp`, session),
      url,
    )
    expect(res.status).toBe(200)
    const body = GetResponseSchema.parse(await res.json())
    expect(body.fields.map((f) => f.key)).toEqual(['server', 'upstream_token'])

    const byKey = Object.fromEntries(body.fields.map((f) => [f.key, f]))
    expect(byKey['server']?.label).toBe('MCP server')
    expect(byKey['server']?.required).toBe(true)
    expect(byKey['server']?.sensitive).toBe(false)
    expect(byKey['server']?.control).toBe('select')

    expect(byKey['upstream_token']?.label).toBe('Credential')
    expect(byKey['upstream_token']?.required).toBe(true)
    expect(byKey['upstream_token']?.sensitive).toBe(true)
  })

  test('GET ?namespace=mcp surfaces the operator catalog', async () => {
    const catalog = [
      { name: 'github', upstream_url: 'https://mcp.example.com/github', default_tool_policy: 'allow' as const },
      {
        name: 'linear',
        upstream_url: 'https://mcp.example.com/linear',
        header: 'X-Token',
        default_tool_policy: 'allow' as const,
      },
    ]
    setMcpCatalog(PLATFORM_INSTANCE_ID, catalog)
    const url = new URL(`https://x/settings/api/coding-credentials?contextId=${personalConfigContextId}&namespace=mcp`)
    const res = await handleCodingCredentialsRoutes(
      get(`/settings/api/coding-credentials?contextId=${personalConfigContextId}&namespace=mcp`, session),
      url,
    )
    expect(res.status).toBe(200)
    const body = GetResponseSchema.parse(await res.json())
    expect(body.catalog).toEqual(catalog)
  })

  test('PATCH ?namespace=mcp saves the credential masked on GET', async () => {
    const patchUrl = new URL('https://x/settings/api/coding-credentials')
    await handleCodingCredentialsRoutes(
      patch('/settings/api/coding-credentials', session, {
        namespace: 'mcp',
        values: { server: 'github', upstream_token: 'mcp-secret' },
      }),
      patchUrl,
    )
    const getUrl = new URL(
      `https://x/settings/api/coding-credentials?contextId=${personalConfigContextId}&namespace=mcp`,
    )
    const res = await handleCodingCredentialsRoutes(
      get(`/settings/api/coding-credentials?contextId=${personalConfigContextId}&namespace=mcp`, session),
      getUrl,
    )
    expect(res.status).toBe(200)
    const body = GetResponseSchema.parse(await res.json())
    const field = body.fields.find((f) => f.key === 'upstream_token')
    expect(field?.hasValue).toBe(true)
    expect(field?.value).not.toContain('mcp-secret')
  })

  test('unknown namespace is rejected', async () => {
    const url = new URL(
      `https://x/settings/api/coding-credentials?contextId=${personalConfigContextId}&namespace=bogus`,
    )
    const res = await handleCodingCredentialsRoutes(
      get(`/settings/api/coding-credentials?contextId=${personalConfigContextId}&namespace=bogus`, session),
      url,
    )
    expect(res.status).toBe(400)
  })

  test('PATCH rejects unknown agent value with 422', async () => {
    const url = new URL('https://x/settings/api/coding-credentials')
    const res = await handleCodingCredentialsRoutes(
      patch('/settings/api/coding-credentials', session, {
        namespace: 'agent-provider',
        values: { agent: 'gemini', provider: 'anthropic', provider_api_key: 'x' },
      }),
      url,
    )
    expect(res.status).toBe(422)
    const body = ErrorResponseSchema.parse(await res.json())
    expect(body.error).toContain('unknown')
  })

  test('PATCH rejects unknown provider value with 422', async () => {
    const url = new URL('https://x/settings/api/coding-credentials')
    const res = await handleCodingCredentialsRoutes(
      patch('/settings/api/coding-credentials', session, {
        namespace: 'agent-provider',
        values: { agent: 'claude', provider: 'azure', provider_api_key: 'x' },
      }),
      url,
    )
    expect(res.status).toBe(422)
    const body = ErrorResponseSchema.parse(await res.json())
    expect(body.error).toContain('unknown')
  })

  test('PATCH ?namespace=forge saves the forge token masked on GET', async () => {
    const patchUrl = new URL('https://x/settings/api/coding-credentials')
    await handleCodingCredentialsRoutes(
      patch('/settings/api/coding-credentials', session, {
        namespace: 'forge',
        values: { kind: 'github', forge_token: 'ghp_secret' },
      }),
      patchUrl,
    )
    const getUrl = new URL(
      `https://x/settings/api/coding-credentials?contextId=${personalConfigContextId}&namespace=forge`,
    )
    const res = await handleCodingCredentialsRoutes(
      get(`/settings/api/coding-credentials?contextId=${personalConfigContextId}&namespace=forge`, session),
      getUrl,
    )
    expect(res.status).toBe(200)
    const body = GetResponseSchema.parse(await res.json())
    const field = body.fields.find((f) => f.key === 'forge_token')
    expect(field?.value).not.toContain('ghp_secret')
  })

  test('forge PATCH requires instance_url for self-hosted kinds', async () => {
    const url = new URL('https://x/settings/api/coding-credentials')
    const bad = await handleCodingCredentialsRoutes(
      patch('/settings/api/coding-credentials', session, {
        namespace: 'forge',
        values: { kind: 'gitlab-self-hosted', forge_token: 't' },
      }),
      url,
    )
    expect(bad.status).toBe(422)

    const ok = await handleCodingCredentialsRoutes(
      patch('/settings/api/coding-credentials', session, {
        namespace: 'forge',
        values: { kind: 'gitlab-self-hosted', instance_url: 'https://gl.corp.com', forge_token: 't' },
      }),
      url,
    )
    expect(ok.status).toBe(200)
  })

  test('forge PATCH rejects unknown kind with 422', async () => {
    const url = new URL('https://x/settings/api/coding-credentials')
    const res = await handleCodingCredentialsRoutes(
      patch('/settings/api/coding-credentials', session, {
        namespace: 'forge',
        values: { kind: 'bitbucket', forge_token: 't' },
      }),
      url,
    )
    expect(res.status).toBe(422)
    const body = ErrorResponseSchema.parse(await res.json())
    expect(body.error).toContain('unknown')
  })

  test('forge PATCH instance_url must be https for self-hosted', async () => {
    const url = new URL('https://x/settings/api/coding-credentials')
    const res = await handleCodingCredentialsRoutes(
      patch('/settings/api/coding-credentials', session, {
        namespace: 'forge',
        values: { kind: 'github-enterprise', instance_url: 'http://ghe.corp.com', forge_token: 't' },
      }),
      url,
    )
    expect(res.status).toBe(422)
  })

  test('openai-compatible provider requires a base URL (422 without, 200 with)', async () => {
    const url = new URL('https://x/settings/api/coding-credentials')
    const bad = await handleCodingCredentialsRoutes(
      patch('/settings/api/coding-credentials', session, {
        namespace: 'agent-provider',
        values: { agent: 'opencode', provider: 'openai-compatible', provider_api_key: 'k' },
      }),
      url,
    )
    expect(bad.status).toBe(422)
    const badBody = ErrorResponseSchema.parse(await bad.json())
    expect(badBody.error).toContain('base URL')

    const ok = await handleCodingCredentialsRoutes(
      patch('/settings/api/coding-credentials', session, {
        namespace: 'agent-provider',
        values: {
          agent: 'opencode',
          provider: 'openai-compatible',
          provider_api_key: 'k',
          provider_base_url: 'https://llm.corp.com/v1',
        },
      }),
      url,
    )
    expect(ok.status).toBe(200)
  })

  test('openai-compatible 422 uses MERGED state: clearing base URL when provider is openai-compatible → 422', async () => {
    // Establish vault with openai-compatible + base URL
    const url = new URL('https://x/settings/api/coding-credentials')
    await handleCodingCredentialsRoutes(
      patch('/settings/api/coding-credentials', session, {
        namespace: 'agent-provider',
        values: {
          agent: 'opencode',
          provider: 'openai-compatible',
          provider_api_key: 'k',
          provider_base_url: 'https://llm.corp.com/v1',
        },
      }),
      url,
    )

    // Now PATCH that clears provider_base_url — merged state is openai-compatible without base URL → 422
    const bad = await handleCodingCredentialsRoutes(
      patch('/settings/api/coding-credentials', session, {
        namespace: 'agent-provider',
        values: { provider_base_url: '' },
      }),
      url,
    )
    expect(bad.status).toBe(422)
    const body = ErrorResponseSchema.parse(await bad.json())
    expect(body.error).toContain('base URL')
  })

  test('openai-compatible 200 uses MERGED state: patch only provider when base URL already stored → 200', async () => {
    // Establish vault with a base URL set (and anthropic provider)
    const url = new URL('https://x/settings/api/coding-credentials')
    await handleCodingCredentialsRoutes(
      patch('/settings/api/coding-credentials', session, {
        namespace: 'agent-provider',
        values: {
          agent: 'opencode',
          provider: 'anthropic',
          provider_api_key: 'k',
          provider_base_url: 'https://llm.corp.com/v1',
        },
      }),
      url,
    )

    // Now PATCH only provider: 'openai-compatible' — merged base URL is non-empty → 200
    const ok = await handleCodingCredentialsRoutes(
      patch('/settings/api/coding-credentials', session, {
        namespace: 'agent-provider',
        values: { provider: 'openai-compatible' },
      }),
      url,
    )
    expect(ok.status).toBe(200)
  })

  test('GET returns model field with control combobox', async () => {
    const url = new URL('https://x/settings/api/coding-credentials')
    const res = await handleCodingCredentialsRoutes(get('/settings/api/coding-credentials', session), url)
    expect(res.status).toBe(200)
    const body = GetResponseSchema.parse(await res.json())
    const modelField = body.fields.find((f) => f.key === 'model')
    expect(modelField).toBeDefined()
    expect(modelField?.control).toBe('combobox')
    expect(modelField?.required).toBe(false)
  })

  test('PATCH accepts a valid model value', async () => {
    const url = new URL('https://x/settings/api/coding-credentials')
    const res = await handleCodingCredentialsRoutes(
      patch('/settings/api/coding-credentials', session, {
        namespace: 'agent-provider',
        values: { agent: 'claude', provider: 'anthropic', provider_api_key: 'k', model: 'claude-sonnet-4-6' },
      }),
      url,
    )
    expect(res.status).toBe(200)
  })

  test('PATCH accepts absent model (optional field)', async () => {
    const url = new URL('https://x/settings/api/coding-credentials')
    const res = await handleCodingCredentialsRoutes(
      patch('/settings/api/coding-credentials', session, {
        namespace: 'agent-provider',
        values: { agent: 'claude', provider: 'anthropic', provider_api_key: 'k' },
      }),
      url,
    )
    expect(res.status).toBe(200)
  })

  test('PATCH accepts model at max length (200 chars)', async () => {
    const url = new URL('https://x/settings/api/coding-credentials')
    const res = await handleCodingCredentialsRoutes(
      patch('/settings/api/coding-credentials', session, {
        namespace: 'agent-provider',
        values: { agent: 'claude', provider: 'anthropic', provider_api_key: 'k', model: 'x'.repeat(200) },
      }),
      url,
    )
    expect(res.status).toBe(200)
  })

  test('PATCH rejects over-long model with 422', async () => {
    const url = new URL('https://x/settings/api/coding-credentials')
    const res = await handleCodingCredentialsRoutes(
      patch('/settings/api/coding-credentials', session, {
        namespace: 'agent-provider',
        values: {
          agent: 'claude',
          provider: 'anthropic',
          provider_api_key: 'k',
          model: 'x'.repeat(201),
        },
      }),
      url,
    )
    expect(res.status).toBe(422)
    const body = ErrorResponseSchema.parse(await res.json())
    expect(body.error).toContain('model')
  })

  test('PATCH rejects model with control characters with 422', async () => {
    const url = new URL('https://x/settings/api/coding-credentials')
    const res = await handleCodingCredentialsRoutes(
      patch('/settings/api/coding-credentials', session, {
        namespace: 'agent-provider',
        values: { agent: 'claude', provider: 'anthropic', provider_api_key: 'k', model: 'a\nb' },
      }),
      url,
    )
    expect(res.status).toBe(422)
    const body = ErrorResponseSchema.parse(await res.json())
    expect(body.error).toContain('model')
  })

  test('forge PATCH token-only (no kind) with github defaults is allowed', async () => {
    // Patching only forge_token without kind should be accepted when existing kind is set
    const url = new URL('https://x/settings/api/coding-credentials')
    // First set kind + token
    await handleCodingCredentialsRoutes(
      patch('/settings/api/coding-credentials', session, {
        namespace: 'forge',
        values: { kind: 'github', forge_token: 'tok-first' },
      }),
      url,
    )
    // Then update only the token — merged kind is 'github', still valid
    const res = await handleCodingCredentialsRoutes(
      patch('/settings/api/coding-credentials', session, {
        namespace: 'forge',
        values: { forge_token: 'tok-second' },
      }),
      url,
    )
    expect(res.status).toBe(200)
  })

  test('rejects oauth-subscription with a non-anthropic provider', async () => {
    const url = new URL('https://x/settings/api/coding-credentials')
    const res = await handleCodingCredentialsRoutes(
      patch('/settings/api/coding-credentials', session, {
        namespace: 'agent-provider',
        values: { agent: 'codex', provider: 'openai', auth_method: 'oauth-subscription', provider_api_key: 'x' },
      }),
      url,
    )
    expect(res.status).toBe(422)
    expect(ErrorResponseSchema.parse(await res.json()).error).toMatch(/anthropic/u)
  })

  test('rejects oauth-subscription combined with a base URL', async () => {
    const url = new URL('https://x/settings/api/coding-credentials')
    const res = await handleCodingCredentialsRoutes(
      patch('/settings/api/coding-credentials', session, {
        namespace: 'agent-provider',
        values: {
          agent: 'claude',
          provider: 'anthropic',
          auth_method: 'oauth-subscription',
          provider_api_key: 'sk-ant-oat01-x',
          provider_base_url: 'https://example.com',
        },
      }),
      url,
    )
    expect(res.status).toBe(422)
    expect(ErrorResponseSchema.parse(await res.json()).error).toMatch(/base URL/u)
  })
})
