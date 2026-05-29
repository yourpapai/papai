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

const capturePostMock = (url: string, init: RequestInit): Promise<Response> => {
  if (url.includes('/group/members') && init.method !== undefined && init.method !== 'GET') {
    capturedPostBody = typeof init.body === 'string' ? init.body : undefined
    return Promise.resolve(json({ ok: true, contextId: 'group:7' }))
  }
  return Promise.resolve(json(membersPayload))
}

afterEach(() => {
  capturedPostBody = undefined
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
})
