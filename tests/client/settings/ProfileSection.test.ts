// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import { setCsrfToken } from '../../../client/settings/fetchers.js'
import ProfileSection from '../../../client/settings/sections/ProfileSection.svelte'
import { restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

const json = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const field = {
  key: 'display_name',
  storageKey: 'display_name',
  label: 'Display name',
  required: false,
  sensitive: false,
  kind: 'preference',
  hasValue: true,
  value: 'Alice',
}

const configWith = (fields: unknown[]): unknown => ({ contextId: 'user:1', fields })

const render = (): { target: HTMLElement; component: ReturnType<typeof mount> } => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.body.querySelector<HTMLElement>('#root')!
  return { target, component: mount(ProfileSection, { target, props: { contextId: 'user:1' } }) }
}

afterEach(() => {
  restoreFetch()
  setCsrfToken('')
})

describe('ProfileSection', () => {
  test('renders the field after the initial load, no loading placeholder', async () => {
    setMockFetch(() => Promise.resolve(json(configWith([field]))))
    const { target, component } = render()
    await drain()
    expect(target.querySelector('[data-testid="cfg-row-display_name"]')).not.toBeNull()
    expect(target.querySelector('.placeholder')).toBeNull()
    void unmount(component)
  })

  test('keeps fields visible during a refetch (no Loading flash)', async () => {
    let resolveSecond: ((r: Response) => void) | null = null
    let n = 0
    const handlers: Array<() => Promise<Response>> = [
      () => Promise.resolve(json(configWith([field]))),
      () =>
        new Promise<Response>((res) => {
          resolveSecond = res
        }),
    ]
    setMockFetch(() => handlers[n++]!())
    const { target, component } = render()
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="profile-refresh"]')!.click()
    flushSync()
    expect(target.querySelector('.placeholder')).toBeNull()
    expect(target.querySelector('[data-testid="cfg-row-display_name"]')).not.toBeNull()
    resolveSecond!(json(configWith([field])))
    await drain()
    void unmount(component)
  })

  test('empty config shows an action linking to the task provider', async () => {
    setMockFetch(() => Promise.resolve(json(configWith([]))))
    const { target, component } = render()
    await drain()
    const action = target.querySelector('.ui-empty__action a')
    expect(action).not.toBeNull()
    expect(action!.getAttribute('href')).toBe('#task-provider')
    void unmount(component)
  })

  test('a failed load shows ErrorState with a working retry', async () => {
    let n = 0
    const handlers: Array<() => Promise<Response>> = [
      () => Promise.resolve(json({ error: 'boom' }, 500)),
      () => Promise.resolve(json(configWith([field]))),
    ]
    setMockFetch(() => handlers[n++]!())
    const { target, component } = render()
    await drain()
    const retry = target.querySelector<HTMLButtonElement>('[data-testid="error-retry"]')
    expect(retry).not.toBeNull()
    retry!.click()
    await drain()
    expect(target.querySelector('[data-testid="cfg-row-display_name"]')).not.toBeNull()
    void unmount(component)
  })

  test('header shows the descriptive sub intro', async () => {
    setMockFetch(() => Promise.resolve(json(configWith([field]))))
    const { target, component } = render()
    await drain()
    expect(target.querySelector('.ui-page-header__sub')?.textContent).toContain('Personal preferences')
    void unmount(component)
  })
})
