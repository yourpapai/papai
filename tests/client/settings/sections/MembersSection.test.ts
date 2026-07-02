// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import { setCsrfToken } from '../../../../client/settings/fetchers.js'
import MembersSection from '../../../../client/settings/sections/MembersSection.svelte'
import { restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

const json = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const membersPayload = {
  contextId: 'group:7',
  members: [{ user_id: '42', added_by: '1', added_at: '2026-05-01' }],
}

let capturedPostBody: string | undefined
let capturedDeleteBody: string | undefined

const capturePostMock = (url: string, init: RequestInit): Promise<Response> => {
  if (url.includes('/group/members') && init.method === 'DELETE') {
    capturedDeleteBody = typeof init.body === 'string' ? init.body : undefined
    return Promise.resolve(json({ ok: true, contextId: 'group:7' }))
  }
  if (url.includes('/group/members') && init.method !== undefined && init.method !== 'GET') {
    capturedPostBody = typeof init.body === 'string' ? init.body : undefined
    return Promise.resolve(json({ ok: true, contextId: 'group:7' }))
  }
  return Promise.resolve(json(membersPayload))
}

const postErrorMock = (url: string, init: RequestInit): Promise<Response> => {
  if (url.includes('/group/members') && init.method === 'POST') {
    return Promise.resolve(new Response('Server Error', { status: 500 }))
  }
  return Promise.resolve(json(membersPayload))
}

afterEach(() => {
  capturedPostBody = undefined
  capturedDeleteBody = undefined
  restoreFetch()
  setCsrfToken('')
})

describe('MembersSection', () => {
  test('lists members', async () => {
    setMockFetch(() => Promise.resolve(json(membersPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(MembersSection, { target, props: { contextId: 'group:7' } })
    await drain()
    expect(target.textContent).toContain('42')
    void unmount(component)
  })

  test('adding a member posts userId + contextId', async () => {
    setCsrfToken('c')
    setMockFetch(capturePostMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(MembersSection, { target, props: { contextId: 'group:7' } })
    await drain()
    const input = target.querySelector<HTMLInputElement>('[data-testid="member-add-input"]')!
    input.value = '99'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="member-add"]')!.click()
    await drain()
    expect(capturedPostBody).toBe(JSON.stringify({ userId: '99', contextId: 'group:7' }))
    void unmount(component)
  })

  test('removing a member sends a DELETE with userId + contextId', async () => {
    setCsrfToken('c')
    setMockFetch(capturePostMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(MembersSection, { target, props: { contextId: 'group:7' } })
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="member-remove-42"]')!.click()
    await drain()
    expect(capturedDeleteBody).toBe(JSON.stringify({ userId: '42', contextId: 'group:7' }))
    void unmount(component)
  })

  test('a failed add keeps the list visible and shows an error', async () => {
    setCsrfToken('c')
    setMockFetch(postErrorMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(MembersSection, { target, props: { contextId: 'group:7' } })
    await drain()
    const input = target.querySelector<HTMLInputElement>('[data-testid="member-add-input"]')!
    input.value = '99'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="member-add"]')!.click()
    await drain()
    expect(target.querySelector('.status-error')).not.toBeNull()
    expect(target.querySelector('[data-testid="member-remove-42"]')).not.toBeNull()
    void unmount(component)
  })

  test('renders section header via PageHeader', async () => {
    setMockFetch(() => Promise.resolve(json(membersPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(MembersSection, { target, props: { contextId: 'group:7' } })
    await drain()
    expect(target.querySelector('.ui-page-header__title')?.textContent).toContain('Members')
    void unmount(component)
  })

  test('renders the add form with kit Input/Btn and members via DataTable', async () => {
    setMockFetch(() => Promise.resolve(json(membersPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(MembersSection, { target, props: { contextId: 'group:7' } })
    await drain()
    expect(target.querySelector('[data-testid="member-add-input"]')?.closest('.ui-input')).not.toBeNull()
    expect(target.querySelector('[data-testid="member-add"]')?.classList.contains('ui-btn')).toBe(true)
    expect(target.querySelector('.ui-datatable')).not.toBeNull()
    void unmount(component)
  })

  test('shows helper text for username support', async () => {
    setMockFetch(() => Promise.resolve(json(membersPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(MembersSection, { target, props: { contextId: 'group:7' } })
    await drain()
    expect(target.textContent).toContain('@username')
    void unmount(component)
  })

  test('input has placeholder for username format', async () => {
    setMockFetch(() => Promise.resolve(json(membersPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(MembersSection, { target, props: { contextId: 'group:7' } })
    await drain()
    const input = target.querySelector<HTMLInputElement>('[data-testid="member-add-input"]')
    expect(input?.placeholder).toBe('123456789 or @username')
    void unmount(component)
  })

  test('shows Loading placeholder before the first fetch resolves, not "No members"', async () => {
    let resolveFetch: (r: Response) => void = () => {}
    setMockFetch(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve
        }),
    )
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(MembersSection, { target, props: { contextId: 'group:7' } })
    flushSync()
    expect(target.textContent).toContain('Loading…')
    expect(target.textContent).not.toContain('No members')
    resolveFetch(json({ contextId: 'group:7', members: [] }))
    await drain()
    expect(target.textContent).toContain('No members')
    void unmount(component)
  })
})
