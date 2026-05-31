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

const sampleMappings = [
  {
    contextId: 'tg:1001',
    providerName: 'kaneo',
    providerUserId: 'ku-1',
    providerUserLogin: 'alice',
    displayName: 'Alice',
    matchedAt: '2026-05-01T00:00:00.000Z',
    matchMethod: 'manual_nl',
    confidence: 1,
  },
  {
    contextId: 'tg:1002',
    providerName: 'kaneo',
    providerUserId: 'ku-2',
    providerUserLogin: 'bob',
    displayName: 'Bob',
    matchedAt: '2026-05-10T00:00:00.000Z',
    matchMethod: 'auto',
    confidence: 0.85,
  },
]

describe('IdentitiesSection', () => {
  test('loads and renders all identity mappings on mount', async () => {
    const calls: string[] = []
    const responses = new Map<string, Response>([['/admin/identity/mappings', Response.json(sampleMappings)]])
    setMockFetch((url) => {
      calls.push(url)
      return responseFor(responses, url)
    })

    const { target, component } = render()
    await drain()

    expect(calls).toEqual(['/admin/identity/mappings'])
    expect(target.textContent).toContain('Alice')
    expect(target.textContent).toContain('alice')
    expect(target.textContent).toContain('Bob')
    expect(target.textContent).toContain('manual_nl')
    expect(target.textContent).toContain('kaneo')

    void unmount(component)
  })

  test('filters rows client-side by contextId substring', async () => {
    const responses = new Map<string, Response>([['/admin/identity/mappings', Response.json(sampleMappings)]])
    setMockFetch((url) => responseFor(responses, url))

    const { target, component } = render()
    await drain()

    const filterInput = target.querySelector<HTMLInputElement>('[data-testid="identities-user-id"]')
    expect(filterInput).not.toBeNull()

    filterInput!.value = 'tg:1001'
    filterInput!.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()

    expect(target.textContent).toContain('Alice')
    expect(target.textContent).not.toContain('Bob')

    void unmount(component)
  })

  test('shows empty state when no mappings are returned', async () => {
    const responses = new Map<string, Response>([['/admin/identity/mappings', Response.json([])]])
    setMockFetch((url) => responseFor(responses, url))

    const { target, component } = render()
    await drain()

    expect(target.textContent).toContain('No mappings found')

    void unmount(component)
  })

  test('shows error when fetch fails', async () => {
    const responses = new Map<string, Response>([
      ['/admin/identity/mappings', Response.json({ error: 'identity failed' }, { status: 500 })],
    ])
    setMockFetch((url) => responseFor(responses, url))

    const { target, component } = render()
    await drain()

    expect(target.textContent).toContain('identity failed')

    void unmount(component)
  })

  test('reload button re-fetches all mappings', async () => {
    const calls: string[] = []
    const responses = new Map<string, Response>([['/admin/identity/mappings', Response.json(sampleMappings)]])
    setMockFetch((url) => {
      calls.push(url)
      return responseFor(responses, url)
    })

    const { target, component } = render()
    await drain()

    const reloadBtn = target.querySelector<HTMLButtonElement>('[data-testid="identities-load"]')
    expect(reloadBtn).not.toBeNull()
    reloadBtn!.click()
    await drain()

    expect(calls.filter((u) => u === '/admin/identity/mappings').length).toBeGreaterThanOrEqual(2)

    void unmount(component)
  })
})
