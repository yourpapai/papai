// SPDX-License-Identifier: BUSL-1.1
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { nervAdminFetch } from '../../../src/debug/settings/nerv-admin-client.js'
import { setPluginAdminConfig } from '../../../src/plugins/store.js'
import { mockLogger, restoreFetch, setMockFetch, setupTestDb } from '../../utils/test-helpers.js'

describe('nervAdminFetch', () => {
  beforeEach(async () => {
    mockLogger()
    process.env['INSTANCE_CONFIG_KEY'] = 'e'.repeat(64)
    await setupTestDb()
  })
  afterEach(() => restoreFetch())

  test('returns not_configured when admin config is unset', async () => {
    const result = await nervAdminFetch('GET', '/projects/self?contextId=x')
    expect(result).toEqual({ ok: false, reason: 'not_configured' })
  })

  test('calls {baseUrl}{path} with a bearer header, trailing slash stripped, and returns status+data', async () => {
    setPluginAdminConfig('nerv', 'nerv_base_url', 'https://nerv.example/', 'admin-1')
    setPluginAdminConfig('nerv', 'nerv_token', 'secret-tok', 'admin-1')
    const captured: { url: string; init: RequestInit }[] = []
    setMockFetch((url, init) => {
      captured.push({ url, init })
      return Promise.resolve(new Response(JSON.stringify({ project: null }), { status: 200 }))
    })
    const result = await nervAdminFetch('GET', '/projects/self?contextId=x')
    expect(result).toEqual({ ok: true, status: 200, data: { project: null } })
    expect(captured[0]?.url).toBe('https://nerv.example/projects/self?contextId=x')
    expect(new Headers(captured[0]?.init.headers).get('Authorization')).toBe('Bearer secret-tok')
  })

  test('returns unreachable when the fetch throws', async () => {
    setPluginAdminConfig('nerv', 'nerv_base_url', 'https://nerv.example', 'admin-1')
    setPluginAdminConfig('nerv', 'nerv_token', 'tok', 'admin-1')
    setMockFetch(() => Promise.reject(new Error('down')))
    const result = await nervAdminFetch('GET', '/projects/self?contextId=x')
    expect(result).toEqual({ ok: false, reason: 'unreachable' })
  })
})
