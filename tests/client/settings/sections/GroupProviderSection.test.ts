// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import { setCsrfToken } from '../../../../client/settings/fetchers.js'
import GroupProviderSection from '../../../../client/settings/sections/GroupProviderSection.svelte'
import { restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

const json = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const payload = {
  contextId: 'group:7',
  taskInstanceId: 'kaneo-a',
  available: [
    { id: 'kaneo-a', type: 'kaneo', status: 'active' },
    { id: 'kaneo-b', type: 'kaneo', status: 'active' },
  ],
}

let capturedPatchBody: string | undefined

const capturePatchMock = (url: string, init: RequestInit): Promise<Response> => {
  if (url.includes('/group/task-instance') && init.method === 'PATCH') {
    capturedPatchBody = typeof init.body === 'string' ? init.body : undefined
    return Promise.resolve(json({ ok: true, contextId: 'group:7' }))
  }
  return Promise.resolve(json(payload))
}

const patchErrorMock = (url: string, init: RequestInit): Promise<Response> => {
  if (url.includes('/group/task-instance') && init.method === 'PATCH') {
    return Promise.resolve(new Response('Server Error', { status: 500 }))
  }
  return Promise.resolve(json(payload))
}

afterEach(() => {
  capturedPatchBody = undefined
  restoreFetch()
  setCsrfToken('')
})

describe('GroupProviderSection', () => {
  test('selects the current task instance and saves a change', async () => {
    setCsrfToken('c')
    setMockFetch(capturePatchMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(GroupProviderSection, { target, props: { contextId: 'group:7' } })
    await drain()
    const select = target.querySelector<HTMLSelectElement>('[data-testid="group-task-instance"]')!
    expect(select.value).toBe('kaneo-a')
    select.value = 'kaneo-b'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="group-task-instance-save"]')!.click()
    await drain()
    expect(capturedPatchBody).not.toBeUndefined()
    expect(capturedPatchBody).toBe(JSON.stringify({ taskInstanceId: 'kaneo-b', contextId: 'group:7' }))
    void unmount(component)
  })

  test('preselects the first available when no task instance is set', async () => {
    const noInstancePayload = {
      contextId: 'group:7',
      taskInstanceId: null,
      available: [
        { id: 'kaneo-a', type: 'kaneo', status: 'active' },
        { id: 'kaneo-b', type: 'kaneo', status: 'active' },
      ],
    }
    setMockFetch(() => Promise.resolve(json(noInstancePayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(GroupProviderSection, { target, props: { contextId: 'group:7' } })
    await drain()
    const select = target.querySelector<HTMLSelectElement>('[data-testid="group-task-instance"]')!
    expect(select.value).toBe('kaneo-a')
    void unmount(component)
  })

  test('falls back to first available when the assigned instance is missing from available', async () => {
    const stalePayload = {
      contextId: 'group:7',
      taskInstanceId: 'gone',
      available: [
        { id: 'kaneo-a', type: 'kaneo', status: 'active' },
        { id: 'kaneo-b', type: 'kaneo', status: 'active' },
      ],
    }
    setMockFetch(() => Promise.resolve(json(stalePayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(GroupProviderSection, { target, props: { contextId: 'group:7' } })
    await drain()
    const select = target.querySelector<HTMLSelectElement>('[data-testid="group-task-instance"]')!
    expect(select.value).toBe('kaneo-a')
    void unmount(component)
  })

  test('a failed save keeps the form visible and shows an error', async () => {
    setCsrfToken('c')
    setMockFetch(patchErrorMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(GroupProviderSection, { target, props: { contextId: 'group:7' } })
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="group-task-instance-save"]')!.click()
    await drain()
    expect(target.querySelector('.status-error')).not.toBeNull()
    expect(target.querySelector('[data-testid="group-task-instance"]')).not.toBeNull()
    void unmount(component)
  })
})
