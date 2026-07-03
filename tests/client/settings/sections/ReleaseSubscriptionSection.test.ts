// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import { setCsrfToken } from '../../../../client/settings/fetchers.js'
import ReleaseSubscriptionSection from '../../../../client/settings/sections/ReleaseSubscriptionSection.svelte'
import { restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

const json = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const render = (): { target: HTMLElement; component: ReturnType<typeof mount> } => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.body.querySelector<HTMLElement>('#root')!
  return {
    target,
    component: mount(ReleaseSubscriptionSection, { target, props: { scope: 'personal', contextId: 'user:1' } }),
  }
}

const isPatch = (init: RequestInit): boolean => init.method === 'PATCH'

const respondByMethod =
  (onPatch: () => Promise<Response>, onOther: () => Promise<Response>) =>
  (_url: string, init: RequestInit): Promise<Response> =>
    isPatch(init) ? onPatch() : onOther()

afterEach(() => {
  restoreFetch()
  setCsrfToken('')
})

describe('ReleaseSubscriptionSection', () => {
  test('shows a Loading placeholder and no toggle while the state is unknown', () => {
    // never resolves
    setMockFetch(() => new Promise<Response>(() => {}))
    const { target, component } = render()
    flushSync()
    expect(target.querySelector('.placeholder')?.textContent).toContain('Loading…')
    expect(target.querySelector('[data-testid="release-subscription-toggle"]')).toBeNull()
    void unmount(component)
  })

  test('renders the Subscribe toggle and caption once loaded (unsubscribed)', async () => {
    setMockFetch(() => Promise.resolve(json({ enabled: false })))
    const { target, component } = render()
    await drain()
    const toggle = target.querySelector<HTMLButtonElement>('[data-testid="release-subscription-toggle"]')
    expect(toggle).not.toBeNull()
    expect(toggle!.textContent).toContain('Subscribe')
    expect(toggle!.classList.contains('ui-btn--primary')).toBe(true)
    expect(target.querySelector('.placeholder')).toBeNull()
    expect(target.querySelector('.settings-section__caption')).not.toBeNull()
    void unmount(component)
  })

  test('renders the Unsubscribe toggle as outline once loaded (subscribed)', async () => {
    setMockFetch(() => Promise.resolve(json({ enabled: true })))
    const { target, component } = render()
    await drain()
    const toggle = target.querySelector<HTMLButtonElement>('[data-testid="release-subscription-toggle"]')
    expect(toggle!.textContent).toContain('Unsubscribe')
    expect(toggle!.classList.contains('ui-btn--outline')).toBe(true)
    void unmount(component)
  })

  test('a failed load shows ErrorState with a working retry and no toggle', async () => {
    let n = 0
    const handlers: Array<() => Promise<Response>> = [
      () => Promise.resolve(json({ error: 'boom' }, 500)),
      () => Promise.resolve(json({ enabled: false })),
    ]
    setMockFetch(() => handlers[n++]!())
    const { target, component } = render()
    await drain()
    expect(target.querySelector('.ui-error')).not.toBeNull()
    expect(target.querySelector('[data-testid="release-subscription-toggle"]')).toBeNull()
    const retry = target.querySelector<HTMLButtonElement>('[data-testid="error-retry"]')
    expect(retry).not.toBeNull()
    retry!.click()
    await drain()
    expect(target.querySelector('[data-testid="release-subscription-toggle"]')).not.toBeNull()
    expect(target.querySelector('.ui-error')).toBeNull()
    void unmount(component)
  })

  test('a failed toggle keeps the toggle visible and shows an inline alert', async () => {
    setCsrfToken('t')
    setMockFetch(
      respondByMethod(
        () => Promise.resolve(json({ error: 'nope' }, 500)),
        () => Promise.resolve(json({ enabled: false })),
      ),
    )
    const { target, component } = render()
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="release-subscription-toggle"]')!.click()
    await drain()
    const alert = target.querySelector('[data-testid="release-subscription-error"]')
    expect(alert).not.toBeNull()
    expect(alert!.getAttribute('role')).toBe('alert')
    expect(target.querySelector('[data-testid="release-subscription-toggle"]')).not.toBeNull()
    void unmount(component)
  })

  test('shows a busy label and aria-busy while a toggle is in flight', async () => {
    setCsrfToken('t')
    // the PATCH request never resolves, so the toggle stays in its busy state
    setMockFetch(
      respondByMethod(
        () => new Promise<Response>(() => {}),
        () => Promise.resolve(json({ enabled: false })),
      ),
    )
    const { target, component } = render()
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="release-subscription-toggle"]')!.click()
    flushSync()
    const toggle = target.querySelector<HTMLButtonElement>('[data-testid="release-subscription-toggle"]')!
    expect(toggle.textContent).toContain('Subscribing…')
    expect(toggle.getAttribute('aria-busy')).toBe('true')
    void unmount(component)
  })
})
