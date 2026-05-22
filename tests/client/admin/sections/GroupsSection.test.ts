// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import GroupsSection from '../../../../client/admin/sections/GroupsSection.svelte'
import { restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const render = (): { target: HTMLElement; component: ReturnType<typeof mount> } => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')
  if (target === null) throw new Error('root missing')
  const component = mount(GroupsSection, { target })
  return { target, component }
}

afterEach(() => {
  restoreFetch()
})

const responseFor = (responses: ReadonlyMap<string, Response>, url: string): Promise<Response> => {
  const response = responses.get(url)
  if (response === undefined) return Promise.resolve(new Response('not mocked', { status: 500 }))
  return Promise.resolve(response)
}

describe('GroupsSection', () => {
  test('loads authorized groups via refresh button', async () => {
    const responses = new Map<string, Response>([
      [
        '/auth/groups',
        Response.json([{ group_id: 'group-1', added_by: 'admin', added_at: '2026-05-21T00:00:00.000Z' }]),
      ],
    ])
    setMockFetch((url) => responseFor(responses, url))

    const { target, component } = render()
    target.querySelector<HTMLButtonElement>('button[type="button"]')!.click()
    await drain()

    expect(target.textContent).toContain('group-1')
    expect(target.textContent).toContain('admin')

    void unmount(component)
  })

  test('shows empty state when no groups are authorized', async () => {
    const responses = new Map<string, Response>([['/auth/groups', Response.json([])]])
    setMockFetch((url) => responseFor(responses, url))

    const { target, component } = render()
    target.querySelector<HTMLButtonElement>('button[type="button"]')!.click()
    await drain()

    expect(target.textContent).toContain('No authorized groups found')

    void unmount(component)
  })

  test('shows fetch errors', async () => {
    const responses = new Map<string, Response>([
      ['/auth/groups', Response.json({ error: 'groups failed' }, { status: 500 })],
    ])
    setMockFetch((url) => responseFor(responses, url))

    const { target, component } = render()
    target.querySelector<HTMLButtonElement>('button[type="button"]')!.click()
    await drain()

    expect(target.textContent).toContain('groups failed')

    void unmount(component)
  })
})
