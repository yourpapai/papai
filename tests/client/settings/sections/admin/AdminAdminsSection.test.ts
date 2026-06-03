// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import { setCsrfToken } from '../../../../../client/settings/fetchers.js'
import AdminAdminsSection from '../../../../../client/settings/sections/admin/AdminAdminsSection.svelte'
import { restoreFetch, setMockFetch } from '../../../../utils/test-helpers.js'

const json = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const rosterPayload = { admins: [{ userId: '1', platformInstanceId: 'tg', createdAt: 1 }] }

let capturedPostBody: string | null = null
let capturedDeleteBody: string | null = null

const captureRosterMock = (url: string, init: RequestInit): Promise<Response> => {
  if (url.includes('/admin/admins') && init.method === 'DELETE') {
    capturedDeleteBody = typeof init.body === 'string' ? init.body : null
    return Promise.resolve(json({ ok: true }))
  }
  if (url.includes('/admin/admins') && init.method === 'POST') {
    capturedPostBody = typeof init.body === 'string' ? init.body : null
    return Promise.resolve(json({ ok: true }))
  }
  return Promise.resolve(json(rosterPayload))
}

const postErrorMock = (url: string, init: RequestInit): Promise<Response> => {
  if (url.includes('/admin/admins') && init.method === 'POST')
    return Promise.resolve(new Response('Internal Server Error', { status: 500 }))
  return Promise.resolve(json(rosterPayload))
}

afterEach(() => {
  capturedPostBody = null
  capturedDeleteBody = null
  restoreFetch()
  setCsrfToken('')
})

describe('AdminAdminsSection', () => {
  test('lists admins and adds one', async () => {
    setCsrfToken('c')
    setMockFetch(captureRosterMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminAdminsSection, { target })
    await drain()
    expect(target.querySelector('#admins')).not.toBeNull()
    const userInput = target.querySelector<HTMLInputElement>('[data-testid="admin-user-input"]')!
    userInput.value = '2'
    userInput.dispatchEvent(new Event('input', { bubbles: true }))
    const platformInput = target.querySelector<HTMLInputElement>('[data-testid="admin-platform-input"]')!
    platformInput.value = 'tg'
    platformInput.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="admin-add"]')!.click()
    await drain()
    expect(capturedPostBody).toBe(JSON.stringify({ userId: '2', platformInstanceId: 'tg' }))
    void unmount(component)
  })

  test('removing an admin sends a DELETE with userId + platformInstanceId', async () => {
    setCsrfToken('c')
    setMockFetch(captureRosterMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminAdminsSection, { target })
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="admin-remove-1"]')!.click()
    await drain()
    expect(capturedDeleteBody).toBe(JSON.stringify({ userId: '1', platformInstanceId: 'tg' }))
    void unmount(component)
  })

  test('renders the add form with Field/Input/Btn and roster via DataTable', async () => {
    setCsrfToken('c')
    setMockFetch(captureRosterMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminAdminsSection, { target })
    await drain()
    expect(target.querySelector('[data-testid="admin-user-input"]')?.closest('.ui-input')).not.toBeNull()
    expect(target.querySelector('[data-testid="admin-add"]')?.classList.contains('ui-btn')).toBe(true)
    expect(target.querySelector('.ui-datatable')).not.toBeNull()
    void unmount(component)
  })

  test('renders section header via PageHeader', async () => {
    setCsrfToken('c')
    setMockFetch(captureRosterMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminAdminsSection, { target })
    await drain()
    expect(target.querySelector('.ui-page-header__title')?.textContent).toContain('Admins')
    void unmount(component)
  })

  test('a failed add keeps the admins table visible and shows an error', async () => {
    setCsrfToken('c')
    setMockFetch(postErrorMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminAdminsSection, { target })
    await drain()
    const userInput = target.querySelector<HTMLInputElement>('[data-testid="admin-user-input"]')!
    userInput.value = '99'
    userInput.dispatchEvent(new Event('input', { bubbles: true }))
    const platformInput = target.querySelector<HTMLInputElement>('[data-testid="admin-platform-input"]')!
    platformInput.value = 'tg'
    platformInput.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="admin-add"]')!.click()
    await drain()
    expect(target.querySelector('.status-error')).not.toBeNull()
    expect(target.querySelector('[data-testid="admin-remove-1"]')).not.toBeNull()
    void unmount(component)
  })
})
