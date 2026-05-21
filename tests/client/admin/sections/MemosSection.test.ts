// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import MemosSection from '../../../../client/admin/sections/MemosSection.svelte'
import { restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const render = (): { target: HTMLElement; component: ReturnType<typeof mount> } => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')
  if (target === null) throw new Error('root missing')
  const component = mount(MemosSection, { target })
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

describe('MemosSection', () => {
  test('loads memos for a user and selected state', async () => {
    const calls: string[] = []
    const responses = new Map<string, Response>([
      [
        '/memos?userId=user-1&state=active',
        Response.json([
          {
            id: 'memo-1',
            userId: 'user-1',
            content: 'remember billing',
            summary: 'billing',
            tags: ['ops'],
            status: 'active',
            createdAt: '2026-05-21T00:00:00.000Z',
            updatedAt: '2026-05-21T01:00:00.000Z',
          },
        ]),
      ],
    ])
    setMockFetch((url) => {
      calls.push(url)
      return responseFor(responses, url)
    })

    const { target, component } = render()
    const userInput = target.querySelector<HTMLInputElement>('[data-testid="memos-user-id"]')
    expect(userInput).not.toBeNull()
    userInput!.value = 'user-1'
    userInput!.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()

    const submitButton = target.querySelector<HTMLButtonElement>('[data-testid="memos-load"]')
    expect(submitButton).not.toBeNull()
    submitButton!.click()
    await drain()

    expect(calls).toEqual(['/memos?userId=user-1&state=active'])
    expect(target.textContent).toContain('remember billing')
    expect(target.textContent).toContain('ops')

    void unmount(component)
  })

  test('shows empty state when no memos are returned', async () => {
    const responses = new Map<string, Response>([['/memos?userId=user-2&state=all', Response.json([])]])
    setMockFetch((url) => responseFor(responses, url))

    const { target, component } = render()
    const userInput = target.querySelector<HTMLInputElement>('[data-testid="memos-user-id"]')
    const stateSelect = target.querySelector<HTMLSelectElement>('[data-testid="memos-state"]')
    userInput!.value = 'user-2'
    userInput!.dispatchEvent(new Event('input', { bubbles: true }))
    stateSelect!.value = 'all'
    stateSelect!.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()

    target.querySelector<HTMLButtonElement>('[data-testid="memos-load"]')!.click()
    await drain()

    expect(target.textContent).toContain('No memos found')

    void unmount(component)
  })

  test('shows fetch errors', async () => {
    const responses = new Map<string, Response>([
      ['/memos?userId=user-3&state=active', Response.json({ error: 'boom' }, { status: 500 })],
    ])
    setMockFetch((url) => responseFor(responses, url))

    const { target, component } = render()
    const userInput = target.querySelector<HTMLInputElement>('[data-testid="memos-user-id"]')
    userInput!.value = 'user-3'
    userInput!.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()

    target.querySelector<HTMLButtonElement>('[data-testid="memos-load"]')!.click()
    await drain()

    expect(target.textContent).toContain('boom')

    void unmount(component)
  })
})
