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

describe('module-sections-fetchers', () => {
  test('fetchModuleSections GETs module-sections and returns parsed sections', async () => {
    const { fetchModuleSections } = await import('../../../client/settings/admin-fetchers.js')
    const payload = {
      sections: [
        {
          id: 'acp',
          label: 'ACP',
          fields: [
            {
              key: 'magi_base_url',
              label: 'Magi base URL',
              value: 'https://magi.example.com',
              sensitive: false,
              required: true,
            },
            { key: 'magi_token', label: 'Magi token', value: '****abcd', sensitive: true, required: true },
          ],
        },
      ],
    }
    let seenUrl = ''
    let seenMethod = ''
    setMockFetch((url, init) => {
      seenUrl = url
      seenMethod = methodOf(init)
      return Promise.resolve(json(payload))
    })
    const result = await fetchModuleSections()
    expect(seenUrl).toBe('/settings/api/admin/module-sections')
    expect(seenMethod).toBe('GET')
    expect(result).toEqual(payload)
  })

  test('patchModuleSection PATCHes module-sections with id/key/value and CSRF header', async () => {
    const { patchModuleSection } = await import('../../../client/settings/admin-fetchers.js')
    setCsrfToken('csrf-pms')
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
    await patchModuleSection({ id: 'acp', key: 'magi_base_url', value: 'https://m' })
    expect(seenUrl).toBe('/settings/api/admin/module-sections')
    expect(seenCsrf).toBe('csrf-pms')
    expect(seenMethod).toBe('PATCH')
    expect(seenBody).toEqual({ id: 'acp', key: 'magi_base_url', value: 'https://m' })
  })

  test('unsetModuleSection PATCHes module-sections with action:unset and CSRF header', async () => {
    const { unsetModuleSection } = await import('../../../client/settings/admin-fetchers.js')
    setCsrfToken('csrf-ums')
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
    await unsetModuleSection({ id: 'acp', key: 'magi_token' })
    expect(seenUrl).toBe('/settings/api/admin/module-sections')
    expect(seenCsrf).toBe('csrf-ums')
    expect(seenMethod).toBe('PATCH')
    expect(seenBody).toEqual({ action: 'unset', id: 'acp', key: 'magi_token' })
  })
})
