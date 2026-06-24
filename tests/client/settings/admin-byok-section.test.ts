// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import { setCsrfToken } from '../../../client/settings/fetchers.js'
import AdminByokSection from '../../../client/settings/sections/admin/AdminByokSection.svelte'
import { restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

const json = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const adminPayload = {
  contexts: [
    {
      contextId: 'user:1',
      enabled: true,
      complete: true,
      missing: [],
      updatedAt: 1710000000000,
      updatedBy: 'admin-user',
    },
    {
      contextId: 'group:bad',
      enabled: true,
      complete: false,
      missing: ['llm_apikey'],
      updatedAt: 1710000001000,
      updatedBy: 'admin-user',
      unreadable: true,
      error: 'stored BYOK LLM credentials are unreadable',
    },
  ],
}

afterEach(() => {
  restoreFetch()
  setCsrfToken('')
})

describe('AdminByokSection', () => {
  test('loads and renders BYOK context summaries', async () => {
    setMockFetch(() => Promise.resolve(json(adminPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminByokSection, { target })

    await drain()

    expect(target.querySelector('#byok-admin')).not.toBeNull()
    expect(target.textContent).toContain('user:1')
    expect(target.textContent).toContain('Enabled')
    expect(target.textContent).toContain('Complete')
    expect(target.textContent).toContain('admin-user')
    void unmount(component)
  })

  test('renders a read-only overview with no enable/disable control', async () => {
    setMockFetch(() => Promise.resolve(json(adminPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminByokSection, { target })

    await drain()

    expect(target.querySelector('[data-testid="admin-byok-toggle-user:1"]')).toBeNull()
    expect(target.textContent).toContain('user:1')
    void unmount(component)
  })

  test('renders unreadable metadata distinctly without secret values', async () => {
    setMockFetch(() => Promise.resolve(json(adminPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminByokSection, { target })

    await drain()

    expect(target.textContent).toContain('Unreadable')
    expect(target.textContent).toContain('stored BYOK LLM credentials are unreadable')
    expect(target.textContent).not.toContain('sk-test-raw-secret')
    void unmount(component)
  })
})
