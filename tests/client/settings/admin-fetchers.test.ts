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
})
