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

const neverResolves = (): Promise<Response> => new Promise<Response>(() => {})

const getHangsMock = (): Promise<Response> => neverResolves()

const patchHangsMock = (url: string, init: RequestInit): Promise<Response> => {
  const isPatch = url.includes('/group/guest-mode') && init.method === 'PATCH'
  return isPatch ? neverResolves() : Promise.resolve(json(disabledPayload))
}

const getFailsThenOkMock = (): ((url: string, init: RequestInit) => Promise<Response>) => {
  let calls = 0
  return () => {
    calls += 1
    return calls === 1
      ? Promise.resolve(new Response('Server Error', { status: 500 }))
      : Promise.resolve(json(disabledPayload))
  }
}

/** Initial GET ok, PATCH ok, but the post-toggle reload GET fails with a 500. */
const getOkThenPatchOkThenReloadFailsMock = (): ((url: string, init: RequestInit) => Promise<Response>) => {
  let getCalls = 0
  return (url, init) => {
    const isPatch = url.includes('/group/guest-mode') && init.method === 'PATCH'
    if (isPatch) return Promise.resolve(json({ ok: true }))
    getCalls += 1
    return getCalls === 1
      ? Promise.resolve(json(disabledPayload))
      : Promise.resolve(new Response('Server Error', { status: 500 }))
  }
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

  test('renders ErrorState with a retry on load failure (no inline toggle error)', async () => {
    setMockFetch(() => Promise.resolve(new Response('Server Error', { status: 500 })))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(GuestModeSection, { target, props: { contextId: 'group:7' } })
    await drain()
    expect(target.querySelector('[data-testid="error-retry"]')).not.toBeNull()
    expect(target.querySelector('[role="alert"]')).not.toBeNull()
    expect(target.querySelector('[data-testid="guest-mode-error"]')).toBeNull()
    expect(target.querySelector('[data-testid="guest-mode-toggle"]')).toBeNull()
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

  test('renders an "Off" mute pill when guest mode is disabled', async () => {
    setMockFetch(() => Promise.resolve(json(disabledPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(GuestModeSection, { target, props: { contextId: 'group:7' } })
    await drain()
    const pill = target.querySelector('.ui-pill')!
    expect(pill).not.toBeNull()
    expect(pill.textContent?.trim()).toBe('Off')
    expect(pill.className).toContain('ui-pill--mute')
    void unmount(component)
  })

  test('renders an "On" warn pill when guest mode is enabled', async () => {
    setMockFetch(() => Promise.resolve(json(enabledPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(GuestModeSection, { target, props: { contextId: 'group:7' } })
    await drain()
    const pill = target.querySelector('.ui-pill')!
    expect(pill.textContent?.trim()).toBe('On')
    expect(pill.className).toContain('ui-pill--warn')
    void unmount(component)
  })

  test('shows a Loading placeholder and hides the toggle before the first load resolves', async () => {
    setMockFetch(getHangsMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(GuestModeSection, { target, props: { contextId: 'group:7' } })
    await drain()
    expect(target.querySelector('.placeholder')?.textContent?.trim()).toBe('Loading…')
    expect(target.querySelector('[data-testid="guest-mode-toggle"]')).toBeNull()
    expect(target.querySelector('.ui-pill')).toBeNull()
    void unmount(component)
  })

  test('shows an "Enabling…" busy label while the toggle PATCH is in flight', async () => {
    setCsrfToken('csrf-tok')
    setMockFetch(patchHangsMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(GuestModeSection, { target, props: { contextId: 'group:7' } })
    await drain()
    const btn = target.querySelector<HTMLButtonElement>('[data-testid="guest-mode-toggle"]')!
    expect(btn.textContent?.trim()).toBe('Enable guest mode')
    btn.click()
    await drain()
    expect(btn.textContent?.trim()).toBe('Enabling…')
    expect(btn.getAttribute('aria-busy')).toBe('true')
    void unmount(component)
  })

  test('a failed post-toggle reload keeps the toggle, no full ErrorState takeover', async () => {
    setCsrfToken('csrf-tok')
    setMockFetch(getOkThenPatchOkThenReloadFailsMock())
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(GuestModeSection, { target, props: { contextId: 'group:7' } })
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="guest-mode-toggle"]')!.click()
    await drain()
    await drain()
    expect(target.querySelector('.ui-error')).toBeNull()
    expect(target.querySelector('[data-testid="guest-mode-toggle"]')).not.toBeNull()
    void unmount(component)
  })

  test('retry after a load failure re-fetches and renders the toggle', async () => {
    setMockFetch(getFailsThenOkMock())
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(GuestModeSection, { target, props: { contextId: 'group:7' } })
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="error-retry"]')!.click()
    await drain()
    expect(target.querySelector('[data-testid="error-retry"]')).toBeNull()
    const btn = target.querySelector<HTMLButtonElement>('[data-testid="guest-mode-toggle"]')!
    expect(btn.textContent?.trim()).toBe('Enable guest mode')
    void unmount(component)
  })
})
