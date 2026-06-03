// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import { setCsrfToken } from '../../../../../client/settings/fetchers.js'
import AdminPluginsApprovalSection from '../../../../../client/settings/sections/admin/AdminPluginsApprovalSection.svelte'
import { restoreFetch, setMockFetch } from '../../../../utils/test-helpers.js'

const json = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const pluginsPayload = {
  contextId: 'user:1',
  plugins: [
    {
      id: 'hello-world',
      name: 'Hello World',
      active: false,
      enabled: false,
      eligibility: { eligible: false, reason: 'inactive' },
      contextConfig: [],
    },
  ],
}

let capturedApprovalBody: string | undefined

const captureApprovalMock = (url: string, init: RequestInit): Promise<Response> => {
  if (url.includes('/admin/plugin-approval') && init.method === 'POST') {
    capturedApprovalBody = typeof init.body === 'string' ? init.body : undefined
    return Promise.resolve(json({ ok: true, state: 'approved' }))
  }
  return Promise.resolve(json(pluginsPayload))
}

const approvalErrorMock = (url: string, init: RequestInit): Promise<Response> => {
  if (url.includes('/admin/plugin-approval') && init.method === 'POST')
    return Promise.resolve(new Response('Internal Server Error', { status: 500 }))
  return Promise.resolve(json(pluginsPayload))
}

const captureRejectionMock = (url: string, init: RequestInit): Promise<Response> => {
  if (url.includes('/admin/plugin-approval') && init.method === 'POST') {
    capturedApprovalBody = typeof init.body === 'string' ? init.body : undefined
    return Promise.resolve(json({ ok: true, state: 'rejected' }))
  }
  return Promise.resolve(json(pluginsPayload))
}

afterEach(() => {
  capturedApprovalBody = undefined
  restoreFetch()
  setCsrfToken('')
})

describe('AdminPluginsApprovalSection', () => {
  test('approves a plugin', async () => {
    setCsrfToken('c')
    setMockFetch(captureApprovalMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminPluginsApprovalSection, { target, props: { catalogContextId: 'user:1' } })
    await drain()
    expect(target.querySelector('#plugin-approval')).not.toBeNull()
    target.querySelector<HTMLButtonElement>('[data-testid="plugin-approve-hello-world"]')!.click()
    await drain()
    expect(capturedApprovalBody).toBe(JSON.stringify({ pluginId: 'hello-world', action: 'approve' }))
    void unmount(component)
  })

  test('rejecting a plugin posts action=reject and shows the status', async () => {
    setCsrfToken('c')
    setMockFetch(captureRejectionMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminPluginsApprovalSection, { target, props: { catalogContextId: 'user:1' } })
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="plugin-reject-hello-world"]')!.click()
    await drain()
    await drain()
    expect(capturedApprovalBody).toBe(JSON.stringify({ pluginId: 'hello-world', action: 'reject' }))
    const statusEl = target.querySelector('.status-success')
    expect(statusEl).not.toBeNull()
    expect(statusEl!.textContent).toContain('rejected')
    void unmount(component)
  })

  test('a failed approval keeps the plugin list visible and shows an error', async () => {
    setCsrfToken('c')
    setMockFetch(approvalErrorMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminPluginsApprovalSection, { target, props: { catalogContextId: 'user:1' } })
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="plugin-approve-hello-world"]')!.click()
    await drain()
    expect(target.querySelector('.status-error')).not.toBeNull()
    expect(target.querySelector('[data-testid="plugin-approve-hello-world"]')).not.toBeNull()
    void unmount(component)
  })

  test('renders section header via PageHeader', async () => {
    setCsrfToken('c')
    setMockFetch(captureApprovalMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminPluginsApprovalSection, { target, props: { catalogContextId: 'user:1' } })
    await drain()
    expect(target.querySelector('.ui-page-header__title')?.textContent).toContain('Plugin approval')
    void unmount(component)
  })

  test('renders plugins via DataTable with StatusPill and approve/reject Btns', async () => {
    setCsrfToken('c')
    setMockFetch(captureApprovalMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminPluginsApprovalSection, { target, props: { catalogContextId: 'user:1' } })
    await drain()
    expect(target.querySelector('.ui-datatable')).not.toBeNull()
    expect(target.querySelector('.ui-pill')).not.toBeNull()
    expect(target.querySelector('[data-testid="plugin-approve-hello-world"]')?.classList.contains('ui-btn')).toBe(true)
    expect(target.querySelector('[data-testid="plugin-reject-hello-world"]')?.classList.contains('ui-btn')).toBe(true)
    void unmount(component)
  })
})
