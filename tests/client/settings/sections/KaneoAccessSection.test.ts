// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import { setCsrfToken } from '../../../../client/settings/fetchers.js'
import KaneoAccessSection from '../../../../client/settings/sections/KaneoAccessSection.svelte'
import { restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

const CONTEXT_ID = 'grp-ctx-test'

const json = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

afterEach(() => {
  restoreFetch()
  setCsrfToken('')
})

describe('KaneoAccessSection', () => {
  test('shows login email when credentials fetch succeeds', async () => {
    setMockFetch(() =>
      Promise.resolve(
        json({ contextId: CONTEXT_ID, login: 'alice@pap.ai', status: 'active', instanceUrl: 'http://kaneo' }),
      ),
    )

    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(KaneoAccessSection, { target, props: { contextId: CONTEXT_ID } })
    await drain()

    expect(target.textContent).toContain('alice@pap.ai')
    void unmount(component)
  })

  test('shows "not provisioned" message when GET returns 404', async () => {
    setMockFetch(() => Promise.resolve(json({ error: 'not found' }, 404)))

    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(KaneoAccessSection, { target, props: { contextId: CONTEXT_ID } })
    await drain()

    expect(target.textContent).toContain('No Kaneo access yet')
    void unmount(component)
  })

  const routeCredentialsMock =
    (getResponse: Response, postResponse: Response) =>
    (url: string, init?: RequestInit): Promise<Response> => {
      if (!url.includes('/settings/api/kaneo/credentials')) return Promise.resolve(json({ error: 'not found' }, 404))
      if ((init?.method ?? 'GET').toUpperCase() === 'POST') return Promise.resolve(postResponse)
      return Promise.resolve(getResponse)
    }

  test('Reveal password button POSTs {action:"reveal"} and reveals password once', async () => {
    setCsrfToken('csrf-test')
    setMockFetch(
      routeCredentialsMock(
        json({ contextId: CONTEXT_ID, login: 'alice@pap.ai', status: 'active', instanceUrl: 'http://kaneo' }),
        json({ password: 'Secret1!Aa', warning: 'This password is shown once. Store it securely.' }),
      ),
    )

    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(KaneoAccessSection, { target, props: { contextId: CONTEXT_ID } })
    await drain()

    const btn = target.querySelector<HTMLButtonElement>('button[data-testid="kaneo-reveal"]')
    expect(btn).not.toBeNull()
    btn!.click()
    await drain()

    expect(target.textContent).toContain('Secret1!Aa')
    void unmount(component)
  })

  test('shows workspace URL when instanceUrl is present', async () => {
    setMockFetch(() =>
      Promise.resolve(
        json({
          contextId: CONTEXT_ID,
          login: 'bob@pap.ai',
          status: 'active',
          instanceUrl: 'http://kaneo.example.com',
        }),
      ),
    )

    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(KaneoAccessSection, { target, props: { contextId: CONTEXT_ID } })
    await drain()

    expect(target.textContent).toContain('http://kaneo.example.com')
    void unmount(component)
  })
})
