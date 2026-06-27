// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import { setCsrfToken } from '../../../client/settings/fetchers.js'
import CodingIdentitySection from '../../../client/settings/sections/CodingIdentitySection.svelte'
import { restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

const json = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const initiatorPayload = { contextId: 'ctx-grp', identity: 'initiator' }
const membersPayload = {
  contextId: 'ctx-grp',
  members: [
    { user_id: 'u-alice', added_by: 'admin', added_at: '2026-01-01T00:00:00Z' },
    { user_id: 'u-bob', added_by: 'admin', added_at: '2026-01-01T00:00:00Z' },
  ],
}

let capturedPatchBody = ''

/** Default read mock: GET coding-identity → initiator; GET members → membersPayload. */
function routeReadMock(url: string, _init?: RequestInit): Promise<Response> {
  if (url.includes('/settings/api/group/members')) return Promise.resolve(json(membersPayload))
  return Promise.resolve(json(initiatorPayload))
}

/** Read + PATCH mock: captures the PATCH body; returns ok; GET falls through to routeReadMock. */
function routePatchMock(url: string, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase()
  if (url.includes('/settings/api/group/coding-identity') && method === 'PATCH') {
    capturedPatchBody = typeof init?.body === 'string' ? init.body : ''
    return Promise.resolve(json({ ok: true, contextId: 'ctx-grp', identity: 'shared' }))
  }
  return routeReadMock(url, init)
}

afterEach(() => {
  capturedPatchBody = ''
  restoreFetch()
  setCsrfToken('')
})

describe('CodingIdentitySection', () => {
  test('renders the section with id coding-identity', async () => {
    setMockFetch(routeReadMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodingIdentitySection, { target, props: { contextId: 'ctx-grp' } })

    await drain()

    expect(target.querySelector('#coding-identity')).not.toBeNull()
    void unmount(component)
  })

  test('renders three policy options (initiator, shared, designated)', async () => {
    setMockFetch(routeReadMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodingIdentitySection, { target, props: { contextId: 'ctx-grp' } })

    await drain()

    const policySelect = target.querySelector<HTMLSelectElement>('[data-testid="coding-identity-policy"]')
    expect(policySelect).not.toBeNull()
    const options = Array.from(policySelect!.options).map((o) => o.value)
    expect(options).toContain('initiator')
    expect(options).toContain('shared')
    expect(options).toContain('designated')
    void unmount(component)
  })

  test('shows "initiator" as the selected option when identity is "initiator"', async () => {
    setMockFetch(routeReadMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodingIdentitySection, { target, props: { contextId: 'ctx-grp' } })

    await drain()

    const policySelect = target.querySelector<HTMLSelectElement>('[data-testid="coding-identity-policy"]')
    expect(policySelect).not.toBeNull()
    expect(policySelect!.value).toBe('initiator')
    void unmount(component)
  })

  test('selecting "designated" shows a member <select>', async () => {
    setMockFetch(routeReadMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodingIdentitySection, { target, props: { contextId: 'ctx-grp' } })

    await drain()

    const policySelect = target.querySelector<HTMLSelectElement>('[data-testid="coding-identity-policy"]')!
    policySelect.value = 'designated'
    policySelect.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    await drain()

    const memberSelect = target.querySelector<HTMLSelectElement>('[data-testid="coding-identity-member"]')
    expect(memberSelect).not.toBeNull()
    void unmount(component)
  })

  test('member select is hidden when policy is "initiator"', async () => {
    setMockFetch(routeReadMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodingIdentitySection, { target, props: { contextId: 'ctx-grp' } })

    await drain()

    const memberSelect = target.querySelector<HTMLSelectElement>('[data-testid="coding-identity-member"]')
    expect(memberSelect).toBeNull()
    void unmount(component)
  })

  test('Save button PATCHes the identity to /settings/api/group/coding-identity', async () => {
    setCsrfToken('csrf-t')
    setMockFetch(routePatchMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodingIdentitySection, { target, props: { contextId: 'ctx-grp' } })

    await drain()

    const policySelect = target.querySelector<HTMLSelectElement>('[data-testid="coding-identity-policy"]')!
    policySelect.value = 'shared'
    policySelect.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()

    target.querySelector<HTMLButtonElement>('[data-testid="coding-identity-save"]')!.click()
    await drain()

    expect(JSON.parse(capturedPatchBody)).toMatchObject({ identity: 'shared', contextId: 'ctx-grp' })
    void unmount(component)
  })
})
