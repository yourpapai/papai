// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import { setCsrfToken } from '../../../../client/settings/fetchers.js'
import PluginsSection from '../../../../client/settings/sections/PluginsSection.svelte'
import { restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

const json = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const extractStringBody = (init: RequestInit): string => (typeof init.body === 'string' ? init.body : '')

const pluginsPayload = {
  contextId: 'user:1',
  plugins: [
    {
      id: 'hello-world',
      name: 'Hello World',
      active: true,
      enabled: false,
      eligibility: { eligible: true },
      contextConfig: [],
    },
    {
      id: 'needs-cfg',
      name: 'Needs Config',
      active: true,
      enabled: false,
      eligibility: { eligible: false, reason: 'config_missing', missingKeys: ['token'] },
      contextConfig: [{ key: 'token', label: 'Token', required: true, sensitive: true, hasValue: false }],
    },
  ],
}

let capturedToggleBody = ''
const captureToggleMock = (url: string, init: RequestInit): Promise<Response> => {
  if (url.includes('/plugins/toggle')) capturedToggleBody = extractStringBody(init)
  return Promise.resolve(json(pluginsPayload))
}

const configPatchRequests: Array<{ url: string; init: RequestInit }> = []
const isConfigPatch = (r: { url: string; init: RequestInit }): boolean =>
  r.url.includes('/plugins/config') && r.init.method === 'PATCH'
const configPayload = {
  contextId: 'user:1',
  plugins: [
    {
      id: 'needs-token',
      name: 'Needs Token',
      active: true,
      enabled: false,
      eligibility: { eligible: false, reason: 'config_missing', missingKeys: ['token'] },
      contextConfig: [{ key: 'token', label: 'Token', required: true, sensitive: false, hasValue: false }],
    },
  ],
}
const trackConfigMock = (url: string, init: RequestInit): Promise<Response> => {
  configPatchRequests.push({ url, init })
  return Promise.resolve(json(configPayload))
}

afterEach(() => {
  capturedToggleBody = ''
  configPatchRequests.length = 0
  restoreFetch()
  setCsrfToken('')
})

describe('PluginsSection', () => {
  test('renders plugins and eligibility reasons', async () => {
    setMockFetch(() => Promise.resolve(json(pluginsPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(PluginsSection, { target, props: { contextId: 'user:1' } })
    await drain()
    expect(target.textContent).toContain('Hello World')
    expect(target.textContent).toContain('config_missing')
    void unmount(component)
  })

  test('enabling an eligible plugin posts enabled=true', async () => {
    setCsrfToken('c')
    setMockFetch(captureToggleMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(PluginsSection, { target, props: { contextId: 'user:1' } })
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="plugin-toggle-hello-world"]')!.click()
    await drain()
    expect(capturedToggleBody).toBe(JSON.stringify({ pluginId: 'hello-world', enabled: true, contextId: 'user:1' }))
    void unmount(component)
  })

  test('saving an empty required plugin config shows an error and does not POST', async () => {
    setCsrfToken('c')
    setMockFetch(trackConfigMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(PluginsSection, { target, props: { contextId: 'user:1' } })
    await drain()

    target.querySelector<HTMLButtonElement>('[data-testid="plugin-cfg-save-needs-token-token"]')!.click()
    await drain()

    const errorEl = target.querySelector('.status-error')
    expect(errorEl).not.toBeNull()
    expect(errorEl!.textContent).toContain('required')
    expect(configPatchRequests.filter(isConfigPatch)).toHaveLength(0)
    void unmount(component)
  })
})
