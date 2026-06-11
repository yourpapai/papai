// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import { setCsrfToken } from '../../../../client/settings/fetchers.js'
import MemorySection from '../../../../client/settings/sections/MemorySection.svelte'
import { restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

const json = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

interface CapturedCall {
  url: string
  method: string
  body: unknown
}

const readRequestBody = (init: RequestInit): unknown => {
  if (typeof init.body !== 'string') return undefined
  return JSON.parse(init.body)
}

const captureCall = (calls: CapturedCall[], url: string, init: RequestInit): void => {
  calls.push({ url, method: init.method ?? 'GET', body: readRequestBody(init) })
}

const memoryPayload = {
  contextId: 'user:1',
  scopeType: 'personal',
  enabled: true,
  profile: 'Pinned profile facts for this context.',
  records: [
    {
      id: 'rec/alpha',
      kind: 'preference',
      content: 'The user prefers short status updates and compact settings screens.',
      summary: 'Prefers compact status updates.',
      tags: ['ui', 'style'],
      confidence: 0.91,
      status: 'active',
      source: 'conversation',
      createdAt: '2026-06-01T10:00:00.000Z',
      updatedAt: '2026-06-02T10:00:00.000Z',
      lastSeenAt: '2026-06-03T10:00:00.000Z',
    },
    {
      id: 'rec-beta',
      kind: 'fact',
      content: 'Fallback record body should render when no summary is available.',
      summary: null,
      tags: [],
      confidence: 0.73,
      status: 'active',
      source: 'manual',
      createdAt: '2026-06-04T10:00:00.000Z',
      updatedAt: '2026-06-05T10:00:00.000Z',
      lastSeenAt: '2026-06-06T10:00:00.000Z',
    },
  ],
}

const emptyMemoryPayload = {
  contextId: 'user:1',
  scopeType: 'personal',
  enabled: false,
  profile: '',
  records: [],
}

afterEach(() => {
  restoreFetch()
  setCsrfToken('')
})

describe('MemorySection', () => {
  test('loads and renders the profile and records', async () => {
    setMockFetch(() => Promise.resolve(json(memoryPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(MemorySection, { target, props: { contextId: 'user:1' } })

    await drain()

    expect(target.querySelector('.ui-page-header__title')?.textContent).toContain('Memory')
    expect(target.querySelector<HTMLTextAreaElement>('[data-testid="memory-profile"]')!.value).toBe(
      'Pinned profile facts for this context.',
    )
    expect(target.textContent).toContain('Prefers compact status updates.')
    expect(target.textContent).toContain('Fallback record body should render')
    expect(target.textContent).toContain('conversation')
    expect(target.textContent).toContain('2026-06-03')
    expect(target.querySelector('[data-testid="memory-empty"]')).toBeNull()
    void unmount(component)
  })

  test('capture toggle sends the next enabled state and reloads', async () => {
    setCsrfToken('c')
    const calls: CapturedCall[] = []
    setMockFetch((url, init) => {
      captureCall(calls, url, init)
      return Promise.resolve(json(memoryPayload))
    })
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(MemorySection, { target, props: { contextId: 'user:1' } })
    await drain()

    target.querySelector<HTMLButtonElement>('[data-testid="memory-capture-toggle"]')!.click()
    await drain()

    const write = calls.find((call) => call.url === '/settings/api/memory/capture')
    expect(write?.method).toBe('PATCH')
    expect(write?.body).toEqual({ contextId: 'user:1', enabled: false })
    expect(calls.filter((call) => call.url.startsWith('/settings/api/memory?')).length).toBe(2)
    void unmount(component)
  })

  test('save profile sends PATCH with contextId and profile', async () => {
    setCsrfToken('c')
    const calls: CapturedCall[] = []
    setMockFetch((url, init) => {
      captureCall(calls, url, init)
      return Promise.resolve(json(memoryPayload))
    })
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(MemorySection, { target, props: { contextId: 'user:1' } })
    await drain()

    const input = target.querySelector<HTMLTextAreaElement>('[data-testid="memory-profile"]')!
    input.value = 'Updated pinned profile.'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    target.querySelector<HTMLButtonElement>('[data-testid="memory-profile-save"]')!.click()
    await drain()

    const write = calls.find((call) => call.url === '/settings/api/memory/profile')
    expect(write?.body).toEqual({ contextId: 'user:1', profile: 'Updated pinned profile.' })
    void unmount(component)
  })

  test('archive record sends DELETE to encoded record path with body contextId and reloads', async () => {
    setCsrfToken('c')
    const calls: CapturedCall[] = []
    setMockFetch((url, init) => {
      captureCall(calls, url, init)
      return Promise.resolve(json(memoryPayload))
    })
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(MemorySection, { target, props: { contextId: 'user:1' } })
    await drain()

    target.querySelector<HTMLButtonElement>('[data-testid="memory-archive-rec/alpha"]')!.click()
    await drain()

    const write = calls.find((call) => call.url === '/settings/api/memory/records/rec%2Falpha')
    expect(write?.method).toBe('DELETE')
    expect(write?.body).toEqual({ contextId: 'user:1' })
    expect(calls.filter((call) => call.url.startsWith('/settings/api/memory?')).length).toBe(2)
    void unmount(component)
  })

  test('clear sends POST and reloads', async () => {
    setCsrfToken('c')
    const calls: CapturedCall[] = []
    setMockFetch((url, init) => {
      captureCall(calls, url, init)
      return Promise.resolve(json(emptyMemoryPayload))
    })
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(MemorySection, { target, props: { contextId: 'user:1' } })
    await drain()

    target.querySelector<HTMLButtonElement>('[data-testid="memory-clear"]')!.click()
    await drain()

    const write = calls.find((call) => call.url === '/settings/api/memory/clear')
    expect(write?.method).toBe('POST')
    expect(write?.body).toEqual({ contextId: 'user:1' })
    expect(calls.filter((call) => call.url.startsWith('/settings/api/memory?')).length).toBe(2)
    void unmount(component)
  })

  test('renders an empty state when there are no records', async () => {
    setMockFetch(() => Promise.resolve(json(emptyMemoryPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(MemorySection, { target, props: { contextId: 'user:1' } })
    await drain()
    expect(target.querySelector('[data-testid="memory-empty"]')).not.toBeNull()
    void unmount(component)
  })

  test('shows an error state when fetch fails', async () => {
    setMockFetch(() => Promise.resolve(new Response('Internal Server Error', { status: 500 })))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(MemorySection, { target, props: { contextId: 'user:1' } })
    await drain()
    expect(target.querySelector('.status-error')).not.toBeNull()
    expect(target.querySelector('[data-testid="memory-profile"]')).toBeNull()
    void unmount(component)
  })
})
