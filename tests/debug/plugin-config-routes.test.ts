// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { handleAdminPluginConfigGet, handleAdminPluginConfigPost } from '../../src/debug/plugin-config-routes.js'
import { startDebugServer, stopDebugServer } from '../../src/debug/server.js'
import { getLogLevel } from '../../src/logger.js'
import { pluginRegistry } from '../../src/plugins/registry.js'
import { setPluginAdminConfig } from '../../src/plugins/store.js'
import { mockLogger, restoreFetch, setupTestDb } from '../utils/test-helpers.js'

const TEST_PORT = 19116
const TOKEN = 'plugin-config-token'
const ADMIN = 'admin-1'

const readJson = async (res: Response): Promise<object> => {
  const parsed: unknown = JSON.parse(await res.text())
  assert(typeof parsed === 'object' && parsed !== null, 'expected JSON object')
  return parsed
}

const pick = (obj: object, key: string): unknown => Reflect.get(obj, key)

const pickArray = (obj: object, key: string): unknown[] => {
  const v = pick(obj, key)
  assert(Array.isArray(v), `expected ${key} to be an array`)
  return v
}

const authHeaders: HeadersInit = {
  Authorization: `Bearer ${TOKEN}`,
  'Content-Type': 'application/json',
}

describe('handleAdminPluginConfigGet (unit)', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    pluginRegistry.clearForTesting()
  })

  test('returns 200 with empty plugins when registry is empty', async () => {
    const res = handleAdminPluginConfigGet()
    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(pick(body, 'plugins')).toEqual([])
  })
})

describe('handleAdminPluginConfigPost (unit)', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    pluginRegistry.clearForTesting()
    delete process.env['DEBUG_TOKEN']
  })

  afterEach(() => {
    process.env['DEBUG_TOKEN'] = TOKEN
  })

  test('returns 401 when DEBUG_TOKEN is unset', async () => {
    const req = new Request('http://localhost/admin/plugin-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pluginId: 'x', key: 'y', value: 'z' }),
    })
    const res = await handleAdminPluginConfigPost(req)
    expect(res.status).toBe(401)
    await res.body?.cancel()
  })
})

describe('debug-server admin/plugin-config routes', () => {
  beforeAll(async () => {
    mockLogger()
    await setupTestDb()
    restoreFetch()
    process.env['DEBUG_PORT'] = String(TEST_PORT)
    process.env['DEBUG_TOKEN'] = TOKEN
    process.env['ADMIN_USER_ID'] = ADMIN
    startDebugServer('test-admin', getLogLevel())
  })

  beforeEach(async () => {
    await setupTestDb()
    pluginRegistry.clearForTesting()
    process.env['DEBUG_TOKEN'] = TOKEN
    process.env['ADMIN_USER_ID'] = ADMIN
  })

  afterEach(() => {
    process.env['DEBUG_TOKEN'] = TOKEN
    process.env['ADMIN_USER_ID'] = ADMIN
  })

  afterAll(() => {
    stopDebugServer()
    delete process.env['DEBUG_PORT']
    delete process.env['DEBUG_TOKEN']
    delete process.env['ADMIN_USER_ID']
  })

  test('GET /admin/plugin-config returns empty snapshot when no plugins registered', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/admin/plugin-config`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(pick(body, 'plugins')).toEqual([])
  })

  test('GET /admin/plugin-config returns plugin config from registry', async () => {
    pluginRegistry.registerDiscovered({
      manifest: {
        id: 'test-plugin',
        name: 'Test Plugin',
        version: '1.0.0',
        description: 'test',
        apiVersion: 1,
        main: 'index.ts',
        contributes: { tools: [], promptFragments: [], commands: [], jobs: [], configKeys: [], taskProviderTypes: [] },
        permissions: [],
        defaultEnabled: false,
        requiredTaskCapabilities: [],
        requiredChatCapabilities: [],
        configRequirements: [{ key: 'api_key', label: 'API Key', required: true, sensitive: true, scope: 'admin' }],
        providerCapabilities: [],
        providerConfigSchema: [],
        providerAllowedHosts: [],
        activationTimeoutMs: 5000,
      },
      pluginDir: '/tmp/test',
      entryPoint: '/tmp/test/index.ts',
      manifestHash: 'abc123',
    })
    setPluginAdminConfig('test-plugin', 'api_key', 'sk-secret9999', ADMIN)

    const res = await fetch(`http://localhost:${TEST_PORT}/admin/plugin-config`, { headers: authHeaders })
    expect(res.status).toBe(200)
    const body = await readJson(res)
    const plugins = pickArray(body, 'plugins')
    expect(plugins).toHaveLength(1)
  })

  test('POST /admin/plugin-config requires the bearer token', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/admin/plugin-config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pluginId: 'x', key: 'y', value: 'z' }),
    })
    expect(res.status).toBe(401)
    await res.body?.cancel()
  })

  test('POST /admin/plugin-config refuses with 401 when DEBUG_TOKEN is unset', async () => {
    delete process.env['DEBUG_TOKEN']
    const res = await fetch(`http://localhost:${TEST_PORT}/admin/plugin-config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pluginId: 'x', key: 'y', value: 'z' }),
    })
    expect(res.status).toBe(401)
    await res.body?.cancel()
  })

  test('POST /admin/plugin-config returns 503 when ADMIN_USER_ID is unset', async () => {
    delete process.env['ADMIN_USER_ID']
    const res = await fetch(`http://localhost:${TEST_PORT}/admin/plugin-config`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ pluginId: 'x', key: 'y', value: 'z' }),
    })
    expect(res.status).toBe(503)
    await res.body?.cancel()
  })

  test('POST /admin/plugin-config rejects unknown plugin with 400', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/admin/plugin-config`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ pluginId: 'nonexistent', key: 'api_key', value: 'x' }),
    })
    expect(res.status).toBe(400)
    await res.body?.cancel()
  })

  test('POST /admin/plugin-config rejects malformed JSON with 400', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/admin/plugin-config`, {
      method: 'POST',
      headers: authHeaders,
      body: 'not-json',
    })
    expect(res.status).toBe(400)
    await res.body?.cancel()
  })

  test('POST /admin/plugin-config with valid body returns 200', async () => {
    pluginRegistry.registerDiscovered({
      manifest: {
        id: 'test-plugin',
        name: 'Test Plugin',
        version: '1.0.0',
        description: 'test',
        apiVersion: 1,
        main: 'index.ts',
        contributes: { tools: [], promptFragments: [], commands: [], jobs: [], configKeys: [], taskProviderTypes: [] },
        permissions: [],
        defaultEnabled: false,
        requiredTaskCapabilities: [],
        requiredChatCapabilities: [],
        configRequirements: [{ key: 'api_key', label: 'API Key', required: true, sensitive: true, scope: 'admin' }],
        providerCapabilities: [],
        providerConfigSchema: [],
        providerAllowedHosts: [],
        activationTimeoutMs: 5000,
      },
      pluginDir: '/tmp/test',
      entryPoint: '/tmp/test/index.ts',
      manifestHash: 'abc123',
    })

    const res = await fetch(`http://localhost:${TEST_PORT}/admin/plugin-config`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ pluginId: 'test-plugin', key: 'api_key', value: 'sk-new-value' }),
    })
    expect(res.status).toBe(200)
    const body = await readJson(res)
    expect(pick(body, 'ok')).toBe(true)
    expect(pick(body, 'pluginId')).toBe('test-plugin')
    expect(pick(body, 'key')).toBe('api_key')
  })

  test('PUT /admin/plugin-config returns 405', async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/admin/plugin-config`, {
      method: 'PUT',
      headers: authHeaders,
    })
    expect(res.status).toBe(405)
    await res.body?.cancel()
  })
})
