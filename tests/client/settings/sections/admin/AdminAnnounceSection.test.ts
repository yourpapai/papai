// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import { setCsrfToken } from '../../../../../client/settings/fetchers.js'
import AdminAnnounceSection from '../../../../../client/settings/sections/admin/AdminAnnounceSection.svelte'
import { restoreFetch, setMockFetch } from '../../../../utils/test-helpers.js'

const json = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const extractStringBody = (init: RequestInit): string | null => (typeof init.body === 'string' ? init.body : null)

let capturedBody: string | null = null

const successMock = (_url: string, init: RequestInit): Promise<Response> => {
  capturedBody = extractStringBody(init)
  return Promise.resolve(json({ totalUsers: 3, successCount: 2, failCount: 1 }))
}

const failMock = (_url: string, _init: RequestInit): Promise<Response> =>
  Promise.resolve(json({ error: 'server error' }, 500))

afterEach(() => {
  capturedBody = null
  restoreFetch()
  setCsrfToken('')
})

describe('AdminAnnounceSection', () => {
  test('sends a message and shows result counts', async () => {
    setCsrfToken('c')
    setMockFetch(successMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminAnnounceSection, { target })
    flushSync()
    const textarea = target.querySelector<HTMLTextAreaElement>('[data-testid="announce-message"]')!
    textarea.value = 'hello all'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="announce-send"]')!.click()
    await drain()
    expect(capturedBody).toBe(JSON.stringify({ message: 'hello all' }))
    const resultEl = target.querySelector<HTMLElement>('[data-testid="announce-result"]')!
    expect(resultEl).not.toBeNull()
    expect(resultEl.textContent).toContain('3')
    expect(resultEl.textContent).toContain('2')
    expect(resultEl.textContent).toContain('1')
    expect(target.querySelector<HTMLTextAreaElement>('[data-testid="announce-message"]')!.value).toBe('')
    void unmount(component)
  })

  test('a failed send shows an error and keeps the textarea', async () => {
    setCsrfToken('c')
    setMockFetch(failMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminAnnounceSection, { target })
    flushSync()
    const textarea = target.querySelector<HTMLTextAreaElement>('[data-testid="announce-message"]')!
    textarea.value = 'broadcast this'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="announce-send"]')!.click()
    await drain()
    const errorEl = target.querySelector<HTMLElement>('.status-error')!
    expect(errorEl).not.toBeNull()
    expect(errorEl.textContent).toContain('server error')
    expect(target.querySelector<HTMLTextAreaElement>('[data-testid="announce-message"]')!.value).toBe('broadcast this')
    void unmount(component)
  })

  test('renders the message field as a multiline Input and Send as a Btn', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(AdminAnnounceSection, { target, props: {} })
    expect(target.querySelector('[data-testid="announce-message"]')?.tagName).toBe('TEXTAREA')
    expect(target.querySelector('[data-testid="announce-send"]')?.classList.contains('ui-btn')).toBe(true)
    void unmount(c)
  })
})
