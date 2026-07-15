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

interface CapturedCall {
  url: string
  method: string
}

const captureCall = (calls: CapturedCall[], url: string, init: RequestInit): void => {
  calls.push({ url, method: init.method ?? 'GET' })
}

const findCall = (calls: CapturedCall[], fragment: string): CapturedCall | undefined =>
  calls.find((c) => c.url.includes(fragment))

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

  test('shows edit form in edit mode on edit button click', async () => {
    setMockFetch(() => Promise.resolve(json(populatedPayload)))
    mount(AdminProvidersSection, { target })
    await drain()

    const editBtn = document.querySelector<HTMLButtonElement>('[data-testid="admin-providers-edit-prov_1"]')!
    editBtn.click()
    await drain()

    expect(document.querySelector('[data-testid="provider-edit-form"]')).not.toBeNull()
    const labelInput = document.querySelector<HTMLInputElement>('[data-testid="provider-edit-form-label"]')!
    expect(labelInput.value).toBe('OpenAI')
  })

  test('refresh-models button triggers refresh-models fetch', async () => {
    const calls: CapturedCall[] = []
    setMockFetch((url, init) => {
      captureCall(calls, url, init)
      return Promise.resolve(json(populatedPayload))
    })
    mount(AdminProvidersSection, { target })
    await drain()

    const refreshBtn = document.querySelector<HTMLButtonElement>(
      '[data-testid="admin-providers-refresh-models-prov_1"]',
    )!
    refreshBtn.click()
    await drain()

    expect(findCall(calls, '/providers/prov_1/refresh-models')?.method).toBe('POST')
  })

  test('shows models editor textarea on models button click', async () => {
    setMockFetch(() => Promise.resolve(json(populatedPayload)))
    mount(AdminProvidersSection, { target })
    await drain()

    const modelsBtn = document.querySelector<HTMLButtonElement>('[data-testid="admin-providers-models-prov_1"]')!
    modelsBtn.click()
    await drain()

    const textarea = document.querySelector<HTMLTextAreaElement>('[data-testid="provider-models-prov_1-textarea"]')!
    expect(textarea).not.toBeNull()
    expect(textarea.value).toBe('gpt-4o')
  })
})
