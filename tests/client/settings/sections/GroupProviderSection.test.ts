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

// 30 microtask ticks (rather than a smaller round number) to reliably drain a
// double network round-trip (save's PATCH followed by its post-save reload)
// through the real Response/json() pipeline in happy-dom; empirically this
// needs ~16 ticks, so 30 leaves comfortable headroom without being wall-clock-based.
const drain = async (): Promise<void> => {
  for (let i = 0; i < 30; i++) await Promise.resolve()
  flushSync()
}

const payload = {
  contextId: 'group:7',
  taskInstanceId: 'kaneo-a',
  available: [
    { id: 'kaneo-a', type: 'kaneo', status: 'active' },
    { id: 'kaneo-b', type: 'kaneo', status: 'active' },
  ],
  canProvision: false,
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

let releasePendingPatch: (() => void) | undefined

const pendingPatchMock = (url: string, init: RequestInit): Promise<Response> => {
  if (url.includes('/group/task-instance') && init.method === 'PATCH') {
    return new Promise<Response>((resolve) => {
      releasePendingPatch = (): void => resolve(json({ ok: true, contextId: 'group:7' }))
    })
  }
  return Promise.resolve(json(payload))
}

afterEach(() => {
  capturedPatchBody = undefined
  releasePendingPatch = undefined
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
      canProvision: false,
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
      canProvision: false,
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

  test('shows an empty state when no active task instances are available', async () => {
    setMockFetch(() =>
      Promise.resolve(json({ contextId: 'group:7', taskInstanceId: null, available: [], canProvision: false })),
    )
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(GroupProviderSection, { target, props: { contextId: 'group:7' } })
    await drain()
    expect(target.textContent).toContain('No active task instances available. Ask an admin to create one.')
    expect(target.querySelector('[data-testid="group-task-instance"]')).toBeNull()
    expect(target.querySelector('[data-testid="group-task-instance-save"]')).toBeNull()
    void unmount(component)
  })

  test('shows a Loading placeholder while the initial fetch is pending', async () => {
    setMockFetch(() => new Promise<Response>(() => {}))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(GroupProviderSection, { target, props: { contextId: 'group:7' } })
    flushSync()
    // let the $effect fire load(), which sets loading=true before its await
    await Promise.resolve()
    flushSync()
    expect(target.querySelector('.placeholder')?.textContent).toContain('Loading')
    expect(target.querySelector('[data-testid="group-task-instance"]')).toBeNull()
    expect(target.querySelector('.ui-error')).toBeNull()
    void unmount(component)
  })

  test('a failed load shows an error state with a retry button and hides the form', async () => {
    setMockFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: 'nope' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(GroupProviderSection, { target, props: { contextId: 'group:7' } })
    await drain()
    expect(target.querySelector('.ui-error')).not.toBeNull()
    expect(target.querySelector('[data-testid="error-retry"]')).not.toBeNull()
    expect(target.querySelector('[data-testid="group-task-instance"]')).toBeNull()
    void unmount(component)
  })

  test('disables and marks the Save button busy while saving', async () => {
    setCsrfToken('c')
    setMockFetch(pendingPatchMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(GroupProviderSection, { target, props: { contextId: 'group:7' } })
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="group-task-instance-save"]')!.click()
    flushSync()
    const btn = target.querySelector<HTMLButtonElement>('[data-testid="group-task-instance-save"]')!
    expect(btn.disabled).toBe(true)
    expect(btn.classList.contains('ui-btn--busy')).toBe(true)
    expect(btn.textContent).toContain('Saving')
    releasePendingPatch?.()
    await drain()
    expect(btn.disabled).toBe(false)
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

  test('renders section header via PageHeader', async () => {
    setMockFetch(capturePatchMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(GroupProviderSection, { target, props: { contextId: 'group:7' } })
    await drain()
    expect(target.querySelector('.ui-page-header__title')?.textContent).toContain('Group task provider')
    void unmount(component)
  })

  test('renders the task-instance Select and Save Btn', async () => {
    setMockFetch(capturePatchMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(GroupProviderSection, { target, props: { contextId: 'group:7' } })
    await drain()
    expect(target.querySelector('[data-testid="group-task-instance"]')?.closest('.ui-select')).not.toBeNull()
    expect(target.querySelector('[data-testid="group-task-instance-save"]')?.classList.contains('ui-btn')).toBe(true)
    void unmount(component)
  })

  test('renders the friendly instance name in options, falling back to id when absent', async () => {
    const namedPayload = {
      contextId: 'group:7',
      taskInstanceId: 'kaneo-a',
      available: [
        { id: 'kaneo-a', type: 'kaneo', status: 'active', name: 'https://kaneo.example' },
        { id: 'kaneo-b', type: 'youtrack', status: 'active' },
      ],
      canProvision: false,
    }
    setMockFetch(() => Promise.resolve(json(namedPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(GroupProviderSection, { target, props: { contextId: 'group:7' } })
    await drain()
    const options = [...target.querySelectorAll('[data-testid="group-task-instance"] option')].map((o) => o.textContent)
    expect(options).toContain('https://kaneo.example (kaneo · active)')
    expect(options).toContain('kaneo-b (youtrack · active)')
    void unmount(component)
  })

  test('associates the Select with its Field label via aria-labelledby', async () => {
    setMockFetch(capturePatchMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(GroupProviderSection, { target, props: { contextId: 'group:7' } })
    await drain()
    const select = target.querySelector<HTMLSelectElement>('[data-testid="group-task-instance"]')!
    const labelledby = select.getAttribute('aria-labelledby')
    expect(labelledby).toBeTruthy()
    const label = target.querySelector(`#${labelledby}`)
    expect(label?.textContent).toContain('Task instance')
    void unmount(component)
  })
})
