// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import { setCsrfToken } from '../../../../client/settings/fetchers.js'
import KaneoAccessSelfSection from '../../../../client/settings/sections/KaneoAccessSelfSection.svelte'
import { restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

const SELF_PATH = '/settings/api/kaneo/credentials/self'

const json = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const memberships = [
  {
    contextId: 'grp-a',
    groupLabel: 'Team A',
    login: 'alice@pap.ai',
    status: 'active',
    kaneoUrl: 'https://kaneo.example.com',
  },
  { contextId: 'grp-b', groupLabel: 'Team B', login: 'alice-b@pap.ai', status: 'inactive', kaneoUrl: null },
]

type Captured = { url: string; method: string; body: unknown }

const routeSelf =
  (getResponse: Response, postResponse: Response, calls: Captured[] = []) =>
  (url: string, init?: RequestInit): Promise<Response> => {
    if (!url.includes(SELF_PATH)) return Promise.resolve(json({ error: 'not found' }, 404))
    const method = (init?.method ?? 'GET').toUpperCase()
    calls.push({ url, method, body: init?.body ?? null })
    return Promise.resolve(method === 'POST' ? postResponse : getResponse)
  }

const mountSection = (target: HTMLElement): ReturnType<typeof mount> => mount(KaneoAccessSelfSection, { target })

afterEach(() => {
  restoreFetch()
  setCsrfToken('')
})

describe('KaneoAccessSelfSection', () => {
  test('lists every membership with login, status, and workspace URL', async () => {
    setMockFetch(routeSelf(json({ memberships }), json({ password: 'p', warning: 'w' })))

    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mountSection(target)
    await drain()

    expect(target.textContent).toContain('Team A')
    expect(target.textContent).toContain('alice@pap.ai')
    expect(target.textContent).toContain('active')
    expect(target.textContent).toContain('https://kaneo.example.com')
    expect(target.textContent).toContain('Team B')
    expect(target.textContent).toContain('alice-b@pap.ai')
    expect(target.textContent).toContain('inactive')
    void unmount(component)
  })

  test('shows an empty state with a working re-check when no membership exists', async () => {
    const calls: Captured[] = []
    setMockFetch(routeSelf(json({ memberships: [] }), json({ password: 'p', warning: 'w' }), calls))

    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mountSection(target)
    await drain()

    expect(target.textContent).toContain('No Kaneo access')
    const recheck = target.querySelector<HTMLButtonElement>('[data-testid="kaneo-self-empty-recheck"]')
    expect(recheck).not.toBeNull()
    recheck!.click()
    await drain()
    expect(calls.filter((call) => call.method === 'GET')).toHaveLength(2)
    void unmount(component)
  })

  test('reveals one membership’s password once and never re-arms its reveal button', async () => {
    setCsrfToken('csrf-self')
    const calls: Captured[] = []
    setMockFetch(
      routeSelf(
        json({ memberships }),
        json({ password: 'OneShot1!Aa', warning: 'This password is shown once. Store it securely.' }),
        calls,
      ),
    )

    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mountSection(target)
    await drain()

    const revealA = target.querySelector<HTMLButtonElement>('[data-testid="kaneo-self-reveal-grp-a"]')
    expect(revealA).not.toBeNull()
    revealA!.click()
    await drain()

    const post = calls.find((call) => call.method === 'POST')
    expect(JSON.parse(String(post?.body))).toEqual({ action: 'reveal', contextId: 'grp-a' })
    expect(target.textContent).toContain('OneShot1!Aa')

    target.querySelector<HTMLButtonElement>('[data-testid="kaneo-self-hide-grp-a"]')!.click()
    await drain()

    expect(target.textContent).not.toContain('OneShot1!Aa')
    expect(target.querySelector('[data-testid="kaneo-self-reveal-grp-a"]')).toBeNull()
    expect(target.querySelector('[data-testid="kaneo-self-pw-hidden-grp-a"]')?.textContent).toContain(
      "can't be shown again",
    )
    // The other membership keeps its own reveal action.
    expect(target.querySelector('[data-testid="kaneo-self-reveal-grp-b"]')).not.toBeNull()
    void unmount(component)
  })

  test('shows the server error and retries on demand', async () => {
    let attempts = 0
    setMockFetch(() => {
      attempts += 1
      return Promise.resolve(attempts === 1 ? json({ error: 'kaneo lookup failed' }, 500) : json({ memberships }))
    })

    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mountSection(target)
    await drain()

    expect(target.textContent).toContain('kaneo lookup failed')
    target.querySelector<HTMLButtonElement>('[data-testid="error-retry"]')!.click()
    await drain()

    expect(target.textContent).toContain('Team A')
    void unmount(component)
  })
})
