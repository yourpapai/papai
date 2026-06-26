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
      },
    })
  })

  test('fetchOpenAccess GETs open-access and returns parsed response', async () => {
    const { fetchOpenAccess } = await import('../../../client/settings/admin-fetchers.js')
    let seenUrl = ''
    let seenMethod = ''
    setMockFetch((url, init) => {
      seenUrl = url
      seenMethod = methodOf(init)
      return Promise.resolve(json({ openDmAccess: false }))
    })
    const result = await fetchOpenAccess()
    expect(seenUrl).toBe('/settings/api/admin/open-access')
    expect(seenMethod).toBe('GET')
    expect(result.openDmAccess).toBe(false)
  })

  test('patchOpenAccess POSTs to open-access with CSRF header', async () => {
    const { patchOpenAccess } = await import('../../../client/settings/admin-fetchers.js')
    setCsrfToken('csrf-oa')
    let seenUrl = ''
    let seenCsrf = ''
    let seenMethod = ''
    let seenBody: unknown
    setMockFetch((url, init) => {
      seenUrl = url
      seenCsrf = csrfHeader(init)
      seenMethod = methodOf(init)
      seenBody = parseBody(init.body)
      return Promise.resolve(json({ ok: true, openDmAccess: true }))
    })
    await patchOpenAccess({ enabled: true })
    expect(seenUrl).toBe('/settings/api/admin/open-access')
    expect(seenCsrf).toBe('csrf-oa')
    expect(seenMethod).toBe('POST')
    expect(seenBody).toEqual({ enabled: true })
  })

  test('setUserBlocked POSTs to users/block with CSRF header', async () => {
    const { setUserBlocked } = await import('../../../client/settings/admin-fetchers.js')
    setCsrfToken('csrf-blk')
    let seenUrl = ''
    let seenCsrf = ''
    let seenMethod = ''
    let seenBody: unknown
    setMockFetch((url, init) => {
      seenUrl = url
      seenCsrf = csrfHeader(init)
      seenMethod = methodOf(init)
      seenBody = parseBody(init.body)
      return Promise.resolve(json({ ok: true }))
    })
    await setUserBlocked({ userId: 'u1', blocked: true })
    expect(seenUrl).toBe('/settings/api/admin/users/block')
    expect(seenCsrf).toBe('csrf-blk')
    expect(seenMethod).toBe('POST')
    expect(seenBody).toEqual({ userId: 'u1', blocked: true })
  })

  test('unsetAdminPluginConfig PATCHes plugin-config with action:unset and CSRF header', async () => {
    const { unsetAdminPluginConfig } = await import('../../../client/settings/admin-fetchers.js')
    setCsrfToken('csrf-uapc')
    let seenUrl = ''
    let seenCsrf = ''
    let seenMethod = ''
    let seenBody: unknown
    setMockFetch((url, init) => {
      seenUrl = url
      seenCsrf = csrfHeader(init)
      seenMethod = methodOf(init)
      seenBody = parseBody(init.body)
      return Promise.resolve(json({ ok: true, pluginId: 'acp', key: 'magi_token' }))
    })
    await unsetAdminPluginConfig({ pluginId: 'acp', key: 'magi_token' })
    expect(seenUrl).toBe('/settings/api/admin/plugin-config')
    expect(seenCsrf).toBe('csrf-uapc')
    expect(seenMethod).toBe('PATCH')
    expect(seenBody).toEqual({ action: 'unset', pluginId: 'acp', key: 'magi_token' })
  })

  test('unsetToolDefaults POSTs tool-defaults with kind:unset and CSRF header', async () => {
    const { unsetToolDefaults } = await import('../../../client/settings/admin-fetchers.js')
    setCsrfToken('csrf-utd')
    const toolsPayload = {
      contextId: '__admin_tool_defaults__:pi-1',
      activePreset: null,
      domains: [],
    }
    let seenUrl = ''
    let seenCsrf = ''
    let seenMethod = ''
    let seenBody: unknown
    setMockFetch((url, init) => {
      seenUrl = url
      seenCsrf = csrfHeader(init)
      seenMethod = methodOf(init)
      seenBody = parseBody(init.body)
      return Promise.resolve(json(toolsPayload))
    })
    const result = await unsetToolDefaults()
    expect(seenUrl).toBe('/settings/api/admin/tool-defaults')
    expect(seenCsrf).toBe('csrf-utd')
    expect(seenMethod).toBe('POST')
    expect(seenBody).toEqual({ kind: 'unset' })
    expect(result.activePreset).toBeNull()
  })

  const releaseNotesPayload = {
    version: '1.2.3',
    body: 'Changes here',
    broadcastAt: null,
    counts: { dm: 5, group: 2 },
  }

  test('fetchReleaseNotes GETs and parses release notes', async () => {
    const { fetchReleaseNotes } = await import('../../../client/settings/admin-fetchers.js')
    let seenUrl = ''
    let seenMethod = ''
    setMockFetch((url, init) => {
      seenUrl = url
      seenMethod = methodOf(init)
      return Promise.resolve(json(releaseNotesPayload))
    })
    const result = await fetchReleaseNotes()
    expect(seenUrl).toBe('/settings/api/admin/release-notes')
    expect(seenMethod).toBe('GET')
    expect(result.version).toBe('1.2.3')
    expect(result.counts.dm).toBe(5)
  })

  test('saveReleaseNotes POSTs action:save with body and CSRF header', async () => {
    const { saveReleaseNotes } = await import('../../../client/settings/admin-fetchers.js')
    setCsrfToken('csrf-srn')
    let seenUrl = ''
    let seenCsrf = ''
    let seenMethod = ''
    let seenBody: unknown
    setMockFetch((url, init) => {
      seenUrl = url
      seenCsrf = csrfHeader(init)
      seenMethod = methodOf(init)
      seenBody = parseBody(init.body)
      return Promise.resolve(json(releaseNotesPayload))
    })
    const result = await saveReleaseNotes('New release notes text')
    expect(seenUrl).toBe('/settings/api/admin/release-notes')
    expect(seenCsrf).toBe('csrf-srn')
    expect(seenMethod).toBe('POST')
    expect(seenBody).toEqual({ action: 'save', body: 'New release notes text' })
    expect(result.version).toBe('1.2.3')
  })

  test('broadcastReleaseNotes POSTs action:broadcast and returns parsed result', async () => {
    const { broadcastReleaseNotes } = await import('../../../client/settings/admin-fetchers.js')
    setCsrfToken('csrf-brn')
    const broadcastPayload = {
      version: '1.2.3',
      broadcast: { sent: 7, failed: 0, skipped: 1 },
      counts: { dm: 5, group: 2 },
    }
    let seenBody: unknown
    setMockFetch((_url, init) => {
      seenBody = parseBody(init.body)
      return Promise.resolve(json(broadcastPayload))
    })
    const result = await broadcastReleaseNotes()
    expect(seenBody).toEqual({ action: 'broadcast' })
    expect(result.broadcast.sent).toBe(7)
    expect(result.broadcast.skipped).toBe(1)
  })
})
