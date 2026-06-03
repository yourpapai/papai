// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import { setCsrfToken } from '../../../../../client/settings/fetchers.js'
import AdminGroupsSection from '../../../../../client/settings/sections/admin/AdminGroupsSection.svelte'
import { restoreFetch, setMockFetch } from '../../../../utils/test-helpers.js'

const json = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const groupsPayload = { groups: [{ group_id: 'g-1', added_by: '1', added_at: '2026-05-01' }] }

let capturedPostBody: string | undefined
let capturedDeleteBody: string | undefined

const captureGroupsMock = (url: string, init: RequestInit): Promise<Response> => {
  if (url.includes('/admin/groups') && init.method === 'DELETE') {
    capturedDeleteBody = typeof init.body === 'string' ? init.body : undefined
    return Promise.resolve(json({ ok: true }))
  }
  if (url.includes('/admin/groups') && init.method === 'POST') {
    capturedPostBody = typeof init.body === 'string' ? init.body : undefined
    return Promise.resolve(json({ ok: true }))
  }
  return Promise.resolve(json(groupsPayload))
}

const postErrorMock = (url: string, init: RequestInit): Promise<Response> => {
  if (url.includes('/admin/groups') && init.method === 'POST')
    return Promise.resolve(new Response('Internal Server Error', { status: 500 }))
  return Promise.resolve(json(groupsPayload))
}

afterEach(() => {
  capturedPostBody = undefined
  capturedDeleteBody = undefined
  restoreFetch()
  setCsrfToken('')
})

describe('AdminGroupsSection', () => {
  test('lists groups and adds one', async () => {
    setCsrfToken('c')
    setMockFetch(captureGroupsMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminGroupsSection, { target })
    await drain()
    expect(target.querySelector('#groups')).not.toBeNull()
    expect(target.textContent).toContain('g-1')
    const input = target.querySelector<HTMLInputElement>('[data-testid="group-add-input"]')!
    input.value = 'g-2'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="group-add"]')!.click()
    await drain()
    expect(capturedPostBody).toBe(JSON.stringify({ groupId: 'g-2' }))
    void unmount(component)
  })

  test('removing a group sends a DELETE with groupId', async () => {
    setCsrfToken('c')
    setMockFetch(captureGroupsMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminGroupsSection, { target })
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="group-remove-g-1"]')!.click()
    await drain()
    expect(capturedDeleteBody).toBe(JSON.stringify({ groupId: 'g-1' }))
    void unmount(component)
  })

  test('a failed add keeps the groups table visible and shows an error', async () => {
    setCsrfToken('c')
    setMockFetch(postErrorMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminGroupsSection, { target })
    await drain()
    const input = target.querySelector<HTMLInputElement>('[data-testid="group-add-input"]')!
    input.value = 'g-bad'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="group-add"]')!.click()
    await drain()
    expect(target.querySelector('.status-error')).not.toBeNull()
    expect(target.querySelector('[data-testid="group-remove-g-1"]')).not.toBeNull()
    void unmount(component)
  })

  test('renders the add form with Field/Input/Btn and groups via DataTable', async () => {
    setCsrfToken('c')
    setMockFetch(captureGroupsMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminGroupsSection, { target })
    await drain()
    expect(target.querySelector('[data-testid="group-add-input"]')?.closest('.ui-input')).not.toBeNull()
    expect(target.querySelector('[data-testid="group-add"]')?.classList.contains('ui-btn')).toBe(true)
    expect(target.querySelector('.ui-datatable')).not.toBeNull()
    void unmount(component)
  })
})
