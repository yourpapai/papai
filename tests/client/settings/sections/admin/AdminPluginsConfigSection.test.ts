// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import { setCsrfToken } from '../../../../../client/settings/fetchers.js'
import AdminPluginsConfigSection from '../../../../../client/settings/sections/admin/AdminPluginsConfigSection.svelte'
import { restoreFetch, setMockFetch } from '../../../../utils/test-helpers.js'

const json = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const snapshotPayload = {
  plugins: [
    {
      pluginId: 'my-plugin',
      keys: [
        { key: 'api_key', label: 'API Key', value: '****cret', sensitive: true, required: true },
        { key: 'endpoint', label: 'Endpoint URL', value: null, sensitive: false, required: false },
      ],
    },
  ],
}

let capturedPatchBody: string | undefined

const capturePatchMock = (url: string, init: RequestInit): Promise<Response> => {
  if (url.includes('/admin/plugin-config') && init.method === 'PATCH') {
    capturedPatchBody = typeof init.body === 'string' ? init.body : undefined
    return Promise.resolve(json({ ok: true, pluginId: 'my-plugin', key: 'api_key', updatedAt: 9999 }))
  }
  return Promise.resolve(json(snapshotPayload))
}

const patchErrorMock = (url: string, init: RequestInit): Promise<Response> => {
  if (url.includes('/admin/plugin-config') && init.method === 'PATCH') {
    return Promise.resolve(
      new Response(JSON.stringify({ error: 'value must be a non-empty string' }), {
        status: 422,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  }
  return Promise.resolve(json(snapshotPayload))
}

afterEach(() => {
  capturedPatchBody = undefined
  restoreFetch()
  setCsrfToken('')
})

describe('AdminPluginsConfigSection', () => {
  test('renders plugin and key rows from snapshot', async () => {
    setMockFetch(() => Promise.resolve(json(snapshotPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminPluginsConfigSection, { target })
    await drain()
    expect(target.querySelector('#plugin-config')).not.toBeNull()
    expect(target.textContent).toContain('my-plugin')
    expect(target.textContent).toContain('API Key')
    expect(target.textContent).toContain('****cret')
    expect(target.textContent).toContain('Endpoint URL')
    void unmount(component)
  })

  test('shows (unset) placeholder for null values', async () => {
    setMockFetch(() => Promise.resolve(json(snapshotPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminPluginsConfigSection, { target })
    await drain()
    // endpoint has value: null — should show unset placeholder
    const endpointRow = target.querySelector('[data-testid="plugin-config-key-my-plugin-endpoint"]')
    expect(endpointRow).not.toBeNull()
    expect(endpointRow!.textContent).toContain('unset')
    void unmount(component)
  })

  test('saving a key posts correct payload', async () => {
    setCsrfToken('c')
    setMockFetch(capturePatchMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminPluginsConfigSection, { target })
    await drain()

    const input = target.querySelector<HTMLInputElement>('[data-testid="plugin-config-input-my-plugin-api_key"]')!
    expect(input).not.toBeNull()
    input.value = 'new-secret-value'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()

    target.querySelector<HTMLButtonElement>('[data-testid="plugin-config-save-my-plugin-api_key"]')!.click()
    await drain()

    expect(capturedPatchBody).toBe(JSON.stringify({ pluginId: 'my-plugin', key: 'api_key', value: 'new-secret-value' }))
    void unmount(component)
  })

  test('sensitive key input is type password', async () => {
    setMockFetch(() => Promise.resolve(json(snapshotPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminPluginsConfigSection, { target })
    await drain()
    const sensitiveInput = target.querySelector<HTMLInputElement>(
      '[data-testid="plugin-config-input-my-plugin-api_key"]',
    )!
    expect(sensitiveInput.type).toBe('password')
    const plainInput = target.querySelector<HTMLInputElement>('[data-testid="plugin-config-input-my-plugin-endpoint"]')!
    expect(plainInput.type).toBe('text')
    void unmount(component)
  })

  test('renders section header via PageHeader', async () => {
    setMockFetch(() => Promise.resolve(json(snapshotPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminPluginsConfigSection, { target })
    await drain()
    expect(target.querySelector('.ui-page-header__title')?.textContent).toContain('Plugin config')
    void unmount(component)
  })

  test('renders masked value via Secret and editor via Field/Input/Btn', async () => {
    setMockFetch(() => Promise.resolve(json(snapshotPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminPluginsConfigSection, { target })
    await drain()
    expect(target.querySelector('.ui-secret')).not.toBeNull()
    expect(
      target.querySelector('[data-testid="plugin-config-input-my-plugin-api_key"]')?.closest('.ui-input'),
    ).not.toBeNull()
    expect(
      target.querySelector('[data-testid="plugin-config-save-my-plugin-api_key"]')?.classList.contains('ui-btn'),
    ).toBe(true)
    void unmount(component)
  })

  test('422 error from PATCH shows error message and keeps the rows visible', async () => {
    setCsrfToken('c')
    setMockFetch(patchErrorMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminPluginsConfigSection, { target })
    await drain()

    const input = target.querySelector<HTMLInputElement>('[data-testid="plugin-config-input-my-plugin-api_key"]')!
    // Use a non-empty value so the client-side guard doesn't short-circuit;
    // the mock returns 422 to simulate server-side rejection.
    input.value = 'bad-value'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="plugin-config-save-my-plugin-api_key"]')!.click()
    await drain()

    expect(target.querySelector('.status-error')).not.toBeNull()
    expect(target.querySelector('[data-testid="plugin-config-key-my-plugin-api_key"]')).not.toBeNull()
    void unmount(component)
  })
})
