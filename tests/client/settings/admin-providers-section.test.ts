// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import { setCsrfToken } from '../../../client/settings/fetchers.js'
import AdminProvidersSection from '../../../client/settings/sections/admin/AdminProvidersSection.svelte'
import { restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

const json = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const populatedPayload = {
  providers: [
    {
      id: 'prov_1',
      label: 'OpenAI',
      providerType: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKeyMasked: '****abcd',
      verification: {
        status: 'verified',
        error: null,
        at: 1717000000000,
        models: ['gpt-4o'],
        modelsFetchedAt: 1717000000000,
      },
    },
  ],
}

let target: HTMLElement

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(() => {
  void unmount(target)
  target.remove()
  restoreFetch()
  setCsrfToken('')
})

describe('AdminProvidersSection', () => {
  test('renders the provider list', async () => {
    setMockFetch(() => Promise.resolve(json(populatedPayload)))
    mount(AdminProvidersSection, { target })
    await drain()

    expect(document.body.textContent).toContain('OpenAI')
    expect(document.body.textContent).toContain('****abcd')
  })

  test('shows add-provider form on button click', async () => {
    setMockFetch(() => Promise.resolve(json(populatedPayload)))
    mount(AdminProvidersSection, { target })
    await drain()

    const addBtn = document.querySelector<HTMLButtonElement>('[data-testid="admin-providers-add"]')!
    addBtn.click()
    await drain()

    expect(document.querySelector('[data-testid="provider-form-type"]')).not.toBeNull()
  })

  test('shows empty state when no providers', async () => {
    setMockFetch(() => Promise.resolve(json({ providers: [] })))
    mount(AdminProvidersSection, { target })
    await drain()

    expect(document.body.textContent).toContain('No providers')
  })

  test('renders error state', async () => {
    setMockFetch(() => Promise.resolve(json({ error: 'boom' }, 500)))
    mount(AdminProvidersSection, { target })
    await drain()

    expect(document.body.textContent).toContain('boom')
  })
})
