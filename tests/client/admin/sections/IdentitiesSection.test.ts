// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import IdentitiesSection from '../../../../client/admin/sections/IdentitiesSection.svelte'
import { restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const render = (): { target: HTMLElement; component: ReturnType<typeof mount> } => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')
  if (target === null) throw new Error('root missing')
  const component = mount(IdentitiesSection, { target })
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

describe('IdentitiesSection', () => {
  test('loads a single identity mapping', async () => {
    const calls: string[] = []
    const responses = new Map<string, Response>([
      [
        '/identity?userId=user-1&provider=kaneo',
        Response.json({
          userId: 'user-1',
          provider: 'kaneo',
          providerUserId: 'provider-1',
          providerUserLogin: 'ki',
          displayName: 'Ki',
        }),
      ],
    ])
    setMockFetch((url) => {
      calls.push(url)
      return responseFor(responses, url)
    })

    const { target, component } = render()
    const userInput = target.querySelector<HTMLInputElement>('[data-testid="identity-user-id"]')
    const providerInput = target.querySelector<HTMLInputElement>('[data-testid="identity-provider"]')
    userInput!.value = 'user-1'
    userInput!.dispatchEvent(new Event('input', { bubbles: true }))
    providerInput!.value = 'kaneo'
    providerInput!.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()

    target.querySelector<HTMLButtonElement>('[data-testid="identity-load"]')!.click()
    await drain()

    expect(calls).toEqual(['/identity?userId=user-1&provider=kaneo'])
    expect(target.textContent).toContain('provider-1')
    expect(target.textContent).toContain('Ki')

    void unmount(component)
  })

  test('shows empty state when identity is not found', async () => {
    const responses = new Map<string, Response>([
      ['/identity?userId=user-2&provider=kaneo', Response.json({ error: 'not found' }, { status: 404 })],
    ])
    setMockFetch((url) => responseFor(responses, url))

    const { target, component } = render()
    const userInput = target.querySelector<HTMLInputElement>('[data-testid="identity-user-id"]')
    const providerInput = target.querySelector<HTMLInputElement>('[data-testid="identity-provider"]')
    userInput!.value = 'user-2'
    userInput!.dispatchEvent(new Event('input', { bubbles: true }))
    providerInput!.value = 'kaneo'
    providerInput!.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()

    target.querySelector<HTMLButtonElement>('[data-testid="identity-load"]')!.click()
    await drain()

    expect(target.textContent).toContain('No identity mapping found')

    void unmount(component)
  })

  test('shows fetch errors', async () => {
    const responses = new Map<string, Response>([
      ['/identity?userId=user-3&provider=kaneo', Response.json({ error: 'identity failed' }, { status: 500 })],
    ])
    setMockFetch((url) => responseFor(responses, url))

    const { target, component } = render()
    const userInput = target.querySelector<HTMLInputElement>('[data-testid="identity-user-id"]')
    const providerInput = target.querySelector<HTMLInputElement>('[data-testid="identity-provider"]')
    userInput!.value = 'user-3'
    userInput!.dispatchEvent(new Event('input', { bubbles: true }))
    providerInput!.value = 'kaneo'
    providerInput!.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()

    target.querySelector<HTMLButtonElement>('[data-testid="identity-load"]')!.click()
    await drain()

    expect(target.textContent).toContain('identity failed')

    void unmount(component)
  })
})
