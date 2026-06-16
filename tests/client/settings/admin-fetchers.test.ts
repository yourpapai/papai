// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { setCsrfToken } from '../../../client/settings/fetchers.js'
import { restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

afterEach(() => {
  restoreFetch()
  setCsrfToken('')
})

const json = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })

const csrfHeader = (init: RequestInit): string => new Headers(init.headers).get('X-Settings-CSRF') ?? ''
const parseBody = (body: BodyInit | null | undefined): unknown => (typeof body === 'string' ? JSON.parse(body) : null)
const methodOf = (init: RequestInit): string => (init.method ?? 'GET').toUpperCase()

describe('admin-fetchers', () => {
  test('fetchAdminSystem GETs admin system config', async () => {
    const { fetchAdminSystem } = await import('../../../client/settings/admin-fetchers.js')
    setMockFetch(() =>
      Promise.resolve(
        json({
          config: { main_model: { value: 'gpt-4o', updatedAt: null, updatedBy: null } },
        }),
      ),
    )
    const result = await fetchAdminSystem()
    expect(result.config).toBeObject()
  })

  test('submitAdminSystem POSTs with CSRF header', async () => {
    const { submitAdminSystem } = await import('../../../client/settings/admin-fetchers.js')
    setCsrfToken('csrf-abc')
    let seenCsrf = ''
    setMockFetch((_url, init) => {
      seenCsrf = csrfHeader(init)
      return Promise.resolve(json({ ok: true }))
    })
    await submitAdminSystem({ key: 'main_model', value: 'gpt-4o' })
    expect(seenCsrf).toBe('csrf-abc')
  })

  test('fetchAdminPlatformInstances GETs platform instances', async () => {
    const { fetchAdminPlatformInstances } = await import('../../../client/settings/admin-fetchers.js')
    setMockFetch(() =>
      Promise.resolve(
        json({
          instances: [{ id: 'tg-main', type: 'telegram', status: 'active', config: {} }],
        }),
      ),
    )
    const result = await fetchAdminPlatformInstances()
    expect(result.instances).toBeArray()
  })

  test('sendAnnounce POSTs message and returns result', async () => {
    const { sendAnnounce } = await import('../../../client/settings/admin-fetchers.js')
    setCsrfToken('csrf-xyz')
    setMockFetch(() => Promise.resolve(json({ totalUsers: 5, successCount: 5, failCount: 0 })))
    const result = await sendAnnounce({ message: 'hello' })
    expect(result.totalUsers).toBe(5)
  })

  const flagsSnapshot = {
    killSwitchEngaged: false,
    contexts: [
      {
        contextId: 'pi:cGktMQ:ctx:dS0x',
        kind: 'user',
        label: 'alice',
        platformInstanceLabel: 'pi-1',
        flags: {
          result_compaction: true,
          progressive_disclosure: false,
          semantic_tool_retrieval: false,
          cross_thread_memory: false,
        },
      },
    ],
  }

  test('fetchAdminFeatureFlags GETs and parses the snapshot', async () => {
    const { fetchAdminFeatureFlags } = await import('../../../client/settings/admin-fetchers.js')
    let seenUrl = ''
    let seenMethod = ''
    setMockFetch((url, init) => {
      seenUrl = url
      seenMethod = methodOf(init)
      return Promise.resolve(json(flagsSnapshot))
    })
    const result = await fetchAdminFeatureFlags()
    expect(seenUrl).toBe('/settings/api/admin/feature-flags')
    expect(seenMethod).toBe('GET')
    expect(result.contexts[0]?.label).toBe('alice')
  })

  test('saveAdminFeatureFlags PATCHes the feature-flags endpoint with CSRF header', async () => {
    const { saveAdminFeatureFlags } = await import('../../../client/settings/admin-fetchers.js')
    setCsrfToken('csrf-ff')
    let seenUrl = ''
    let seenCsrf = ''
    let seenMethod = ''
    let seenBody: unknown
    setMockFetch((url, init) => {
      seenUrl = url
      seenCsrf = csrfHeader(init)
      seenMethod = methodOf(init)
      seenBody = parseBody(init.body)
      return Promise.resolve(json(flagsSnapshot.contexts[0]))
    })
    await saveAdminFeatureFlags({
      contextId: 'pi:cGktMQ:ctx:dS0x',
      flags: {
        result_compaction: true,
        progressive_disclosure: false,
        semantic_tool_retrieval: false,
        cross_thread_memory: false,
      },
    })
    expect(seenUrl).toBe('/settings/api/admin/feature-flags')
    expect(seenCsrf).toBe('csrf-ff')
    expect(seenMethod).toBe('PATCH')
    expect(seenBody).toEqual({
      contextId: 'pi:cGktMQ:ctx:dS0x',
      flags: {
        result_compaction: true,
        progressive_disclosure: false,
        semantic_tool_retrieval: false,
        cross_thread_memory: false,
      },
    })
  })
})
