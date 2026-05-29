// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import { setCsrfToken } from '../../../../client/settings/fetchers.js'
import IdentitySection from '../../../../client/settings/sections/IdentitySection.svelte'
import { restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

const json = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const identityPayload = {
  contextId: 'user:1',
  providerName: 'kaneo',
  mapping: {
    providerUserId: 'u-9',
    providerUserLogin: 'jane',
    displayName: 'Jane',
    matchedAt: '2026-05-01T00:00:00.000Z',
    matchMethod: 'manual_nl',
    confidence: 1,
  },
}

afterEach(() => {
  restoreFetch()
  setCsrfToken('')
})

describe('IdentitySection', () => {
  test('renders the current mapping', async () => {
    setMockFetch(() => Promise.resolve(json(identityPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(IdentitySection, { target, props: { contextId: 'user:1' } })
    await drain()
    expect(target.textContent).toContain('kaneo')
    expect(target.querySelector<HTMLInputElement>('[data-testid="identity-user-id"]')!.value).toBe('u-9')
    void unmount(component)
  })

  test('shows a notice when no task instance is configured (422)', async () => {
    setMockFetch(() => Promise.resolve(json({ error: 'no task instance configured for this context' }, 422)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(IdentitySection, { target, props: { contextId: 'user:1' } })
    await drain()
    expect(target.textContent).toContain('no task instance')
    void unmount(component)
  })

  test('renders empty form when mapping is null (task instance configured but no identity set)', async () => {
    setMockFetch(() =>
      Promise.resolve(
        json({
          contextId: 'user:1',
          providerName: 'kaneo',
          mapping: null,
        }),
      ),
    )
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(IdentitySection, { target, props: { contextId: 'user:1' } })
    await drain()
    expect(target.textContent).toContain('kaneo')
    const userIdInput = target.querySelector<HTMLInputElement>('[data-testid="identity-user-id"]')
    expect(userIdInput).not.toBeNull()
    expect(userIdInput!.value).toBe('')
    void unmount(component)
  })
})
