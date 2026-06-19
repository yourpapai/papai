// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import { setCsrfToken } from '../../../../client/settings/fetchers.js'
import GuestModeSection from '../../../../client/settings/sections/GuestModeSection.svelte'
import { restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

const json = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const disabledPayload = { contextId: 'group:7', enabled: false }
const enabledPayload = { contextId: 'group:7', enabled: true }

let capturedPatchBody: string | undefined

const capturePatchMock =
  (fetchPayload: unknown) =>
  (url: string, init: RequestInit): Promise<Response> => {
    const isPatch = url.includes('/group/guest-mode') && init.method === 'PATCH'
    if (isPatch) capturedPatchBody = typeof init.body === 'string' ? init.body : undefined
    return isPatch ? Promise.resolve(json({ ok: true })) : Promise.resolve(json(fetchPayload))
  }

const patchErrorMock = (url: string, init: RequestInit): Promise<Response> => {
  const isPatch = url.includes('/group/guest-mode') && init.method === 'PATCH'
  return isPatch
    ? Promise.resolve(new Response('Server Error', { status: 500 }))
    : Promise.resolve(json(disabledPayload))
}

afterEach(() => {
  capturedPatchBody = undefined
  restoreFetch()
  setCsrfToken('')
})

describe('GuestModeSection', () => {
  test('renders "Enable guest mode" label when guest mode is disabled', async () => {
    setMockFetch(() => Promise.resolve(json(disabledPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(GuestModeSection, { target, props: { contextId: 'group:7' } })
    await drain()
    const btn = target.querySelector<HTMLButtonElement>('[data-testid="guest-mode-toggle"]')!
    expect(btn).not.toBeNull()
    expect(btn.textContent?.trim()).toBe('Enable guest mode')
    void unmount(component)
  })

  test('renders "Disable guest mode" label when guest mode is enabled', async () => {
    setMockFetch(() => Promise.resolve(json(enabledPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(GuestModeSection, { target, props: { contextId: 'group:7' } })
    await drain()
    const btn = target.querySelector<HTMLButtonElement>('[data-testid="guest-mode-toggle"]')!
    expect(btn.textContent?.trim()).toBe('Disable guest mode')
    void unmount(component)
  })

  test('calls patchGroupGuestMode with enabled: true when toggled from disabled', async () => {
    setCsrfToken('csrf-tok')
    setMockFetch(capturePatchMock(disabledPayload))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(GuestModeSection, { target, props: { contextId: 'group:7' } })
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="guest-mode-toggle"]')!.click()
    await drain()
    expect(capturedPatchBody).not.toBeUndefined()
    expect(capturedPatchBody).toBe(JSON.stringify({ contextId: 'group:7', enabled: true }))
    void unmount(component)
  })

  test('calls patchGroupGuestMode with enabled: false when toggled from enabled', async () => {
    setCsrfToken('csrf-tok')
    setMockFetch(capturePatchMock(enabledPayload))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(GuestModeSection, { target, props: { contextId: 'group:7' } })
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="guest-mode-toggle"]')!.click()
    await drain()
    expect(capturedPatchBody).not.toBeUndefined()
    expect(capturedPatchBody).toBe(JSON.stringify({ contextId: 'group:7', enabled: false }))
    void unmount(component)
  })

  test('shows an error when the fetch fails', async () => {
    setMockFetch(() => Promise.resolve(new Response('Server Error', { status: 500 })))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(GuestModeSection, { target, props: { contextId: 'group:7' } })
    await drain()
    expect(target.querySelector('[data-testid="guest-mode-error"]')).not.toBeNull()
    void unmount(component)
  })

  test('shows an error when the patch fails', async () => {
    setCsrfToken('csrf-tok')
    setMockFetch(patchErrorMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(GuestModeSection, { target, props: { contextId: 'group:7' } })
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="guest-mode-toggle"]')!.click()
    await drain()
    expect(target.querySelector('[data-testid="guest-mode-error"]')).not.toBeNull()
    void unmount(component)
  })

  test('renders section header with Group eyebrow and Guest mode title', async () => {
    setMockFetch(() => Promise.resolve(json(disabledPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(GuestModeSection, { target, props: { contextId: 'group:7' } })
    await drain()
    expect(target.querySelector('.ui-page-header__title')?.textContent).toContain('Guest mode')
    void unmount(component)
  })
})
