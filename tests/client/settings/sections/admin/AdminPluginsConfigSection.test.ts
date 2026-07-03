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
let capturedClearBody: unknown = null

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

const captureUnsetMock = (url: string, init: RequestInit): Promise<Response> => {
  if (url.includes('/admin/plugin-config') && init.method === 'PATCH') {
    capturedClearBody = typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : null
    return Promise.resolve(json({ ok: true, pluginId: 'my-plugin', key: 'api_key' }))
  }
  return Promise.resolve(json(snapshotPayload))
}

const clearFailsMock = (url: string, init: RequestInit): Promise<Response> => {
  if (url.includes('/admin/plugin-config') && init.method === 'PATCH') {
    return Promise.resolve(new Response('Server Error', { status: 500 }))
  }
  return Promise.resolve(json(snapshotPayload))
}

afterEach(() => {
  capturedPatchBody = undefined
  capturedClearBody = null
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

  test('Clear button appears only for keys that have a value set', async () => {
    setMockFetch(() => Promise.resolve(json(snapshotPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminPluginsConfigSection, { target })
    await drain()
    // api_key has value '****cret' → Clear should be visible
    expect(target.querySelector('[data-testid="plugin-config-clear-my-plugin-api_key"]')).not.toBeNull()
    // endpoint has value null → Clear should NOT be visible
    expect(target.querySelector('[data-testid="plugin-config-clear-my-plugin-endpoint"]')).toBeNull()
    void unmount(component)
  })

  test('clicking Clear and confirming calls unsetAdminPluginConfig with correct args and refreshes', async () => {
    setCsrfToken('c')
    setMockFetch(captureUnsetMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminPluginsConfigSection, { target })
    await drain()

    target.querySelector<HTMLButtonElement>('[data-testid="plugin-config-clear-my-plugin-api_key"]')!.click()
    await drain()
    // Confirm dialog should now be open
    expect(target.querySelector('.modal')).not.toBeNull()
    // Click the last "Clear" button in the modal (the confirm action button)
    const clearBtns = Array.from(target.querySelectorAll<HTMLButtonElement>('button')).filter((b) =>
      b.textContent?.includes('Clear'),
    )
    clearBtns.at(-1)!.click()
    await drain()

    expect(capturedClearBody).toEqual({ action: 'unset', pluginId: 'my-plugin', key: 'api_key' })
    void unmount(component)
  })

  test('a failed clear confirm keeps the dialog open and shows an inline error', async () => {
    setCsrfToken('c')
    setMockFetch(clearFailsMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminPluginsConfigSection, { target })
    await drain()

    target.querySelector<HTMLButtonElement>('[data-testid="plugin-config-clear-my-plugin-api_key"]')!.click()
    await drain()
    expect(target.querySelector('.modal')).not.toBeNull()

    target.querySelector<HTMLButtonElement>('.modal .ui-btn--danger')!.click()
    await drain()

    expect(target.querySelector('.modal')).not.toBeNull()
    expect(target.querySelector('.modal .status-error')).not.toBeNull()
    void unmount(component)
  })
})
