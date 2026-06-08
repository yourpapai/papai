// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import { setCsrfToken } from '../../../../../client/settings/fetchers.js'
import AdminUsersSection from '../../../../../client/settings/sections/admin/AdminUsersSection.svelte'
import { restoreFetch, setMockFetch } from '../../../../utils/test-helpers.js'

const json = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const usersPayload = { users: [{ platform_user_id: '42', platform_instance_id: 'tg', username: 'jane' }] }

let capturedPostBody: string | undefined
let capturedDeleteBody: string | undefined

const captureUsersMock = (url: string, init: RequestInit): Promise<Response> => {
  if (url.includes('/admin/users') && init.method === 'DELETE') {
    capturedDeleteBody = typeof init.body === 'string' ? init.body : undefined
    return Promise.resolve(json({ ok: true }))
  }
  if (url.includes('/admin/users') && init.method === 'POST') {
    capturedPostBody = typeof init.body === 'string' ? init.body : undefined
    return Promise.resolve(json({ ok: true }))
  }
  return Promise.resolve(json(usersPayload))
}

const postErrorMock = (url: string, init: RequestInit): Promise<Response> => {
  if (url.includes('/admin/users') && init.method === 'POST')
    return Promise.resolve(new Response('Internal Server Error', { status: 500 }))
  return Promise.resolve(json(usersPayload))
}

afterEach(() => {
  capturedPostBody = undefined
  capturedDeleteBody = undefined
  restoreFetch()
  setCsrfToken('')
})

describe('AdminUsersSection', () => {
  test('lists users', async () => {
    setMockFetch(() => Promise.resolve(json(usersPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    expect(target.querySelector('#users')).not.toBeNull()
    expect(target.textContent).toContain('jane')
    expect(target.querySelectorAll('tbody tr').length).toBe(1)
    void unmount(component)
  })

  test('renders search box for users table', async () => {
    setMockFetch(() => Promise.resolve(json(usersPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    expect(target.querySelector('[data-testid="settings-table-search"]')).not.toBeNull()
    void unmount(component)
  })

  test('adding a user posts userId', async () => {
    setCsrfToken('c')
    setMockFetch(captureUsersMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    const input = target.querySelector<HTMLInputElement>('[data-testid="user-add-input"]')!
    input.value = '99'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="user-add"]')!.click()
    await drain()
    expect(capturedPostBody).toBe(JSON.stringify({ userId: '99' }))
    void unmount(component)
  })

  test('removing a user sends a DELETE with userId', async () => {
    setCsrfToken('c')
    setMockFetch(captureUsersMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="user-remove-42"]')!.click()
    await drain()
    expect(capturedDeleteBody).toBe(JSON.stringify({ userId: '42' }))
    void unmount(component)
  })

  test('adding a user with a username posts userId + username', async () => {
    setCsrfToken('c')
    setMockFetch(captureUsersMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    const idInput = target.querySelector<HTMLInputElement>('[data-testid="user-add-input"]')!
    idInput.value = '55'
    idInput.dispatchEvent(new Event('input', { bubbles: true }))
    const usernameInput = target.querySelectorAll<HTMLInputElement>('input')[1]!
    usernameInput.value = 'alice'
    usernameInput.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="user-add"]')!.click()
    await drain()
    expect(capturedPostBody).toBe(JSON.stringify({ userId: '55', username: 'alice' }))
    void unmount(component)
  })

  test('a failed add keeps the users table visible and shows an error', async () => {
    setCsrfToken('c')
    setMockFetch(postErrorMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    const input = target.querySelector<HTMLInputElement>('[data-testid="user-add-input"]')!
    input.value = '77'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="user-add"]')!.click()
    await drain()
    expect(target.querySelector('.status-error')).not.toBeNull()
    expect(target.querySelector('[data-testid="user-remove-42"]')).not.toBeNull()
    void unmount(component)
  })

  test('renders section header via PageHeader', async () => {
    setCsrfToken('c')
    setMockFetch(captureUsersMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    expect(target.querySelector('.ui-page-header__title')?.textContent).toContain('Users')
    void unmount(component)
  })

  test('renders the add form with Field/Input/Btn and users via DataTable', async () => {
    setCsrfToken('c')
    setMockFetch(captureUsersMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminUsersSection, { target })
    await drain()
    expect(target.querySelector('[data-testid="user-add-input"]')?.closest('.ui-input')).not.toBeNull()
    expect(target.querySelector('[data-testid="user-add"]')?.classList.contains('ui-btn')).toBe(true)
    expect(target.querySelector('.ui-datatable')).not.toBeNull()
    void unmount(component)
  })
})
