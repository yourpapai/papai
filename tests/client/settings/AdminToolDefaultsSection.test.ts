// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import { setCsrfToken } from '../../../client/settings/fetchers.js'
import AdminToolDefaultsSection from '../../../client/settings/sections/admin/AdminToolDefaultsSection.svelte'
import { restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

const json = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const toolsPayload = {
  contextId: '__admin_tool_defaults__:pi-1',
  activePreset: null,
  domains: [
    {
      domain: 'task',
      summary: 'allow',
      tools: [{ name: 'create_task', permission: 'allow', risk: 'write' }],
    },
  ],
}

let capturedUrl: string | undefined
let capturedBody: unknown = null
let capturedClearBody: unknown = null

const toolsPayloadWithPreset = {
  contextId: '__admin_tool_defaults__:pi-1',
  activePreset: 'read-only',
  domains: [
    {
      domain: 'task',
      summary: 'allow',
      tools: [{ name: 'create_task', permission: 'allow', risk: 'write' }],
    },
  ],
}

const clearedToolsPayload = {
  contextId: '__admin_tool_defaults__:pi-1',
  activePreset: null,
  domains: [
    {
      domain: 'task',
      summary: 'allow',
      tools: [{ name: 'create_task', permission: 'allow', risk: 'write' }],
    },
  ],
}

const captureMock = (url: string, init: RequestInit): Promise<Response> => {
  capturedUrl = url
  if (init.method === 'POST') {
    capturedBody = typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : init.body
  }
  return Promise.resolve(json(toolsPayload))
}

const captureUnsetMock = (url: string, init: RequestInit): Promise<Response> => {
  capturedUrl = url
  if (init.method === 'POST') {
    capturedBody = typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : init.body
    capturedClearBody = capturedBody
    return Promise.resolve(json(clearedToolsPayload))
  }
  return Promise.resolve(json(toolsPayloadWithPreset))
}

afterEach(() => {
  capturedUrl = undefined
  capturedBody = null
  capturedClearBody = null
  restoreFetch()
  setCsrfToken('')
})

describe('AdminToolDefaultsSection', () => {
  test('mounting calls fetchToolDefaults (admin endpoint), not fetchTools', async () => {
    setMockFetch(captureMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminToolDefaultsSection, { target })
    await drain()
    const url = String(capturedUrl)
    expect(url).toContain('/settings/api/admin/tool-defaults')
    expect(url).not.toContain('/settings/api/tools')
    void unmount(component)
  })

  test('renders a section with id="tool-defaults" and the title "Default tool permissions"', async () => {
    setMockFetch(() => Promise.resolve(json(toolsPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminToolDefaultsSection, { target })
    await drain()
    expect(target.querySelector('#tool-defaults')).not.toBeNull()
    expect(target.querySelector('.ui-page-header__title')?.textContent).toContain('Default tool permissions')
    void unmount(component)
  })

  test('applying a preset calls applyToolDefaultPreset (admin endpoint)', async () => {
    setCsrfToken('c')
    setMockFetch(captureMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminToolDefaultsSection, { target })
    await drain()
    // Reset capture after initial load
    capturedUrl = undefined
    capturedBody = null
    // Click the read-only preset button to trigger a preset change
    target.querySelector<HTMLButtonElement>('[data-testid="preset-read-only"]')!.click()
    flushSync()
    // Confirm the preset application
    target.querySelector<HTMLButtonElement>('[data-testid="preset-confirm-apply"]')!.click()
    await drain()
    expect(String(capturedUrl)).toContain('/settings/api/admin/tool-defaults')
    expect(JSON.stringify(capturedBody)).toContain('"kind":"preset"')
    expect(JSON.stringify(capturedBody)).toContain('"preset":"read-only"')
    void unmount(component)
  })

  test('Clear admin defaults button is visible when activePreset is set', async () => {
    setMockFetch(() => Promise.resolve(json(toolsPayloadWithPreset)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminToolDefaultsSection, { target })
    await drain()
    expect(target.querySelector('[data-testid="tool-defaults-clear"]')).not.toBeNull()
    void unmount(component)
  })

  test('Clear admin defaults button is NOT visible when activePreset is null', async () => {
    setMockFetch(() => Promise.resolve(json(toolsPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminToolDefaultsSection, { target })
    await drain()
    expect(target.querySelector('[data-testid="tool-defaults-clear"]')).toBeNull()
    void unmount(component)
  })

  test('clicking Clear admin defaults and confirming POSTs kind:unset to admin endpoint', async () => {
    setCsrfToken('c')
    setMockFetch(captureUnsetMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminToolDefaultsSection, { target })
    await drain()

    target.querySelector<HTMLButtonElement>('[data-testid="tool-defaults-clear"]')!.click()
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="tool-defaults-clear-confirm-apply"]')!.click()
    await drain()

    expect(String(capturedUrl)).toContain('/settings/api/admin/tool-defaults')
    expect(capturedClearBody).toEqual({ kind: 'unset' })
    void unmount(component)
  })
})
