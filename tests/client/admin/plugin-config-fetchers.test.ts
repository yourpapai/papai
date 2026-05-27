// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { fetchAdminPluginConfig, submitAdminPluginConfig } from '../../../client/admin/plugin-config-fetchers.js'
import { restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

const captured: Array<{ readonly url: string; readonly init: RequestInit }> = []

beforeEach(() => {
  captured.length = 0
})

afterEach(() => {
  restoreFetch()
})

const installFetch = (status: number, payload: unknown): void => {
  setMockFetch((url, init) => {
    captured.push({ url, init })
    return Promise.resolve(
      new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })
}

describe('fetchAdminPluginConfig', () => {
  test('fetches and parses plugin config snapshot', async () => {
    installFetch(200, {
      plugins: [
        {
          pluginId: 'test-plugin',
          keys: [{ key: 'apiKey', label: 'API Key', value: null, sensitive: true, required: true }],
        },
      ],
    })

    const result = await fetchAdminPluginConfig()
    expect(result.plugins).toHaveLength(1)
    expect(result.plugins[0]?.pluginId).toBe('test-plugin')
  })

  test('throws on non-ok response', async () => {
    setMockFetch(() => Promise.resolve(new Response('Unauthorized', { status: 401 })))
    await expect(fetchAdminPluginConfig()).rejects.toThrow()
  })
})

describe('submitAdminPluginConfig', () => {
  test('submits config and parses response', async () => {
    installFetch(200, {
      ok: true,
      pluginId: 'test-plugin',
      key: 'apiKey',
      updatedAt: 1716800000000,
    })

    const result = await submitAdminPluginConfig({
      pluginId: 'test-plugin',
      key: 'apiKey',
      value: 'secret-value',
    })
    expect(result.ok).toBe(true)
    expect(result.pluginId).toBe('test-plugin')
  })

  test('sends POST with correct body', async () => {
    installFetch(200, {
      ok: true,
      pluginId: 'test-plugin',
      key: 'apiKey',
      updatedAt: 1716800000000,
    })

    await submitAdminPluginConfig({
      pluginId: 'test-plugin',
      key: 'apiKey',
      value: 'secret-value',
    })

    const first = captured[0]
    expect(first?.url).toBe('/admin/plugin-config')
    expect(first?.init?.method).toBe('POST')
    expect(first?.init?.body).toBe(
      JSON.stringify({
        pluginId: 'test-plugin',
        key: 'apiKey',
        value: 'secret-value',
      }),
    )
  })
})
