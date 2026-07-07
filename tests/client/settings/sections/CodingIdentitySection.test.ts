// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import { setCsrfToken } from '../../../../client/settings/fetchers.js'
import CodingIdentitySection from '../../../../client/settings/sections/CodingIdentitySection.svelte'
import { restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

const CTX = 'ctx-group-1'

const json = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })

const identity = (value: string): Response => json({ contextId: CTX, identity: value })
const membersPayload = (members: unknown[]): Response => json({ contextId: CTX, members })

const ALICE = {
  user_id: 'u1',
  added_by: 'admin',
  added_at: '2026-05-01T00:00:00Z',
  user_label: 'Alice (@alice)',
  added_by_label: 'Admin',
}
const BOB = { user_id: 'u2', added_by: 'u1', added_at: '2026-05-02T00:00:00Z', user_label: null, added_by_label: null }

// 30 microtask ticks drain the async load, and the save path's PATCH + reload
// round-trip (each through fetch → Response.json → Zod.parse), which empirically
// needs ~16 ticks; 30 leaves comfortable headroom without being wall-clock-based.
const drain = async (): Promise<void> => {
  for (let i = 0; i < 30; i++) await Promise.resolve()
  flushSync()
}

const render = (): { target: HTMLElement; component: ReturnType<typeof mount> } => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.body.querySelector<HTMLElement>('#root')!
  return { target, component: mount(CodingIdentitySection, { target, props: { contextId: CTX } }) }
}

const submitForm = (target: HTMLElement): void => {
  target
    .querySelector<HTMLFormElement>('form.settings-form')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
}

/** Route reads by URL and writes by method; identity read uses the given sequence of responses. */
const route = (opts: {
  identitySeq?: Response[]
  identity?: Response
  members?: Response
  patch?: Response | 'never'
}): ((url: string, init: RequestInit) => Promise<Response>) => {
  let identityCall = 0
  // Every branch clones its Response before returning it: a Response body can only be
  // read once (fetchGroupCodingIdentity/fetchGroupMembers call res.json()), and save()
  // triggers a second read of the same fixed Response via its post-PATCH reload — without
  // cloning, that second read throws "Body has already been used" and gets surfaced as a
  // (misleading) load error.
  return (url, init) => {
    if ((init.method ?? 'GET').toUpperCase() === 'PATCH') {
      if (opts.patch === 'never') return new Promise<Response>(() => {})
      return Promise.resolve((opts.patch ?? json({})).clone())
    }
    if (url.includes('/coding-identity')) {
      if (opts.identitySeq)
        return Promise.resolve((opts.identitySeq[identityCall++] ?? opts.identitySeq.at(-1)!).clone())
      return Promise.resolve((opts.identity ?? identity('shared')).clone())
    }
    if (url.includes('/members')) return Promise.resolve((opts.members ?? membersPayload([ALICE])).clone())
    return Promise.resolve(json({}, 404))
  }
}

afterEach(() => {
  restoreFetch()
  setCsrfToken('')
})

describe('CodingIdentitySection', () => {
  test('shows a Loading placeholder and no policy select while state is unknown', () => {
    setMockFetch(() => new Promise<Response>(() => {}))
    const { target, component } = render()
    flushSync()
    expect(target.querySelector('.placeholder')?.textContent).toContain('Loading…')
    expect(target.querySelector('[data-testid="coding-identity-policy"]')).toBeNull()
    void unmount(component)
  })

  test('renders the policy control via the shared Select once loaded', async () => {
    setMockFetch(route({ identity: identity('shared'), members: membersPayload([ALICE, BOB]) }))
    const { target, component } = render()
    await drain()
    expect(target.querySelector('.placeholder')).toBeNull()
    expect(target.querySelector('[data-testid="coding-identity-policy"]')).not.toBeNull()
    expect(target.querySelector('.ui-select')).not.toBeNull()
    expect(target.querySelector('.settings-section__caption')).not.toBeNull()
    void unmount(component)
  })

  test('lists members by label, not raw id, under the Designated policy', async () => {
    setMockFetch(route({ identity: identity('designated:u1'), members: membersPayload([ALICE, BOB]) }))
    const { target, component } = render()
    await drain()
    const memberSelect = target.querySelector('[data-testid="coding-identity-member"]')
    expect(memberSelect).not.toBeNull()
    const optionText = Array.from(memberSelect!.querySelectorAll('option')).map((o) => o.textContent)
    expect(optionText).toContain('Alice (@alice)')
    expect(optionText).not.toContain('u1')
    void unmount(component)
  })

  test('disables Save and shows a hint when Designated has no member', async () => {
    setMockFetch(route({ identity: identity('shared'), members: membersPayload([]) }))
    const { target, component } = render()
    await drain()
    const policy = target.querySelector<HTMLSelectElement>('[data-testid="coding-identity-policy"]')!
    policy.value = 'designated'
    policy.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    const save = target.querySelector<HTMLButtonElement>('[data-testid="coding-identity-save"]')!
    expect(save.disabled).toBe(true)
    expect(target.querySelector('.ui-field__error')?.textContent).toContain('Add a group member')
    void unmount(component)
  })

  test('a failed load shows ErrorState with a working retry and no form', async () => {
    setMockFetch(route({ identitySeq: [json({ error: 'boom' }, 500), identity('shared')] }))
    const { target, component } = render()
    await drain()
    expect(target.querySelector('.ui-error')).not.toBeNull()
    expect(target.querySelector('[data-testid="coding-identity-policy"]')).toBeNull()
    const retry = target.querySelector<HTMLButtonElement>('[data-testid="error-retry"]')!
    expect(retry).not.toBeNull()
    retry.click()
    await drain()
    expect(target.querySelector('.ui-error')).toBeNull()
    expect(target.querySelector('[data-testid="coding-identity-policy"]')).not.toBeNull()
    void unmount(component)
  })

  test('shows a success message after a successful Save', async () => {
    setCsrfToken('t')
    setMockFetch(route({ identity: identity('shared'), members: membersPayload([ALICE]) }))
    const { target, component } = render()
    await drain()
    submitForm(target)
    await drain()
    expect(target.querySelector('.status-success')?.textContent).toContain('Saved.')
    void unmount(component)
  })

  test('shows a busy Save label and aria-busy while saving', async () => {
    setCsrfToken('t')
    setMockFetch(route({ identity: identity('shared'), members: membersPayload([ALICE]), patch: 'never' }))
    const { target, component } = render()
    await drain()
    submitForm(target)
    flushSync()
    const save = target.querySelector<HTMLButtonElement>('[data-testid="coding-identity-save"]')!
    expect(save.textContent).toContain('Saving…')
    expect(save.getAttribute('aria-busy')).toBe('true')
    void unmount(component)
  })

  test('a failed Save shows an inline alert and keeps the form', async () => {
    setCsrfToken('t')
    setMockFetch(
      route({ identity: identity('shared'), members: membersPayload([ALICE]), patch: json({ error: 'nope' }, 500) }),
    )
    const { target, component } = render()
    await drain()
    submitForm(target)
    await drain()
    const alert = target.querySelector('[data-testid="coding-identity-error"]')
    expect(alert).not.toBeNull()
    expect(alert!.getAttribute('role')).toBe('alert')
    expect(target.querySelector('[data-testid="coding-identity-policy"]')).not.toBeNull()
    void unmount(component)
  })
})
