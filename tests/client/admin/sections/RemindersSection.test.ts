// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import RemindersSection from '../../../../client/admin/sections/RemindersSection.svelte'
import { restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const render = (): { target: HTMLElement; component: ReturnType<typeof mount> } => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')
  if (target === null) throw new Error('root missing')
  const component = mount(RemindersSection, { target })
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

describe('RemindersSection', () => {
  test('loads recurring and deferred reminders for a user', async () => {
    const calls: string[] = []
    const responses = new Map<string, Response>([
      [
        '/recurring?userId=user-1',
        Response.json([
          {
            id: 'rec-1',
            userId: 'user-1',
            title: 'Daily sync',
            rrule: 'FREQ=DAILY',
            nextRun: '2026-05-22T00:00:00.000Z',
            enabled: true,
            lastRun: null,
          },
        ]),
      ],
      [
        '/deferred?userId=user-1',
        Response.json([
          {
            id: 'def-1',
            createdByUserId: 'user-1',
            prompt: 'Follow up tomorrow',
            fireAt: '2026-05-22T10:00:00.000Z',
            rrule: null,
            status: 'active',
          },
        ]),
      ],
    ])
    setMockFetch((url) => {
      calls.push(url)
      return responseFor(responses, url)
    })

    const { target, component } = render()
    const userInput = target.querySelector<HTMLInputElement>('[data-testid="reminders-user-id"]')
    userInput!.value = 'user-1'
    userInput!.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()

    target.querySelector<HTMLButtonElement>('[data-testid="reminders-load"]')!.click()
    await drain()

    expect(calls).toEqual(['/recurring?userId=user-1', '/deferred?userId=user-1'])
    expect(target.textContent).toContain('Daily sync')
    expect(target.textContent).toContain('Follow up tomorrow')

    void unmount(component)
  })

  test('shows empty state when both reminder lists are empty', async () => {
    const responses = new Map<string, Response>([
      ['/recurring?userId=user-2', Response.json([])],
      ['/deferred?userId=user-2', Response.json([])],
    ])
    setMockFetch((url) => responseFor(responses, url))

    const { target, component } = render()
    const userInput = target.querySelector<HTMLInputElement>('[data-testid="reminders-user-id"]')
    userInput!.value = 'user-2'
    userInput!.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()

    target.querySelector<HTMLButtonElement>('[data-testid="reminders-load"]')!.click()
    await drain()

    expect(target.textContent).toContain('No reminders found')

    void unmount(component)
  })

  test('shows fetch errors', async () => {
    const responses = new Map<string, Response>([
      ['/recurring?userId=user-3', Response.json({ error: 'recurring failed' }, { status: 500 })],
      ['/deferred?userId=user-3', Response.json([])],
    ])
    setMockFetch((url) => responseFor(responses, url))

    const { target, component } = render()
    const userInput = target.querySelector<HTMLInputElement>('[data-testid="reminders-user-id"]')
    userInput!.value = 'user-3'
    userInput!.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()

    target.querySelector<HTMLButtonElement>('[data-testid="reminders-load"]')!.click()
    await drain()

    expect(target.textContent).toContain('recurring failed')

    void unmount(component)
  })
})
