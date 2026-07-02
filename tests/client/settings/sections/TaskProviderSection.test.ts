// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import { setCsrfToken } from '../../../../client/settings/fetchers.js'
import TaskProviderSection from '../../../../client/settings/sections/TaskProviderSection.svelte'
import { restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

const json = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const configPayload = {
  contextId: 'user:1',
  fields: [
    {
      key: 'timezone',
      storageKey: 'timezone',
      label: 'Timezone',
      required: true,
      sensitive: false,
      kind: 'preference',
      hasValue: true,
      value: 'UTC',
    },
    {
      key: 'kaneo_apikey',
      storageKey: 'kaneo_apikey',
      label: 'Kaneo API Key',
      required: false,
      sensitive: true,
      kind: 'provider-context',
      hasValue: false,
      value: '',
    },
  ],
}

const provisionPayload = {
  status: 'provisioned',
  contextId: 'user:1',
  email: 'a@b.c',
  password: 'p@ss',
  kaneoUrl: 'https://k',
  workspaceId: 'w1',
}

const boundInstancePayload = {
  contextId: 'user:1',
  taskInstanceId: 'kaneo-1',
  available: [{ id: 'kaneo-1', type: 'kaneo', status: 'active' }],
  canProvision: true,
}

const boundNonProvisionablePayload = {
  contextId: 'user:1',
  taskInstanceId: 'yt-default',
  available: [{ id: 'yt-default', type: 'youtrack', status: 'active' }],
  canProvision: false,
}

const unboundInstancePayload = {
  contextId: 'user:1',
  taskInstanceId: null,
  available: [{ id: 'yt-default', type: 'youtrack', status: 'active' }],
  canProvision: false,
}

const noInstancesPayload = { contextId: 'user:1', taskInstanceId: null, available: [], canProvision: false }

/** Route both the config and the context task-instance endpoints from a single mock. */
const routeMock =
  (instance: unknown, config: unknown = configPayload) =>
  (url: string): Promise<Response> => {
    if (url.includes('/settings/api/context/task-instance')) return Promise.resolve(json(instance))
    if (url.includes('/settings/api/provision/kaneo')) return Promise.resolve(json(provisionPayload))
    return Promise.resolve(json(config))
  }

interface PatchRecord {
  method: string
  body: string
}

/**
 * Route the context task-instance endpoint, recording any PATCH into `sink.value`.
 * GET returns the unbound payload; the config endpoint returns no fields.
 */
const routeBindingMock =
  (sink: { value: PatchRecord | null }) =>
  (url: string, init?: RequestInit): Promise<Response> => {
    const method = (init?.method ?? 'GET').toUpperCase()
    const isInstance = url.includes('/settings/api/context/task-instance')
    if (isInstance && method === 'PATCH') {
      sink.value = { method, body: typeof init?.body === 'string' ? init.body : '' }
      return Promise.resolve(json({ ok: true, contextId: 'user:1' }))
    }
    if (isInstance) return Promise.resolve(json(unboundInstancePayload))
    return Promise.resolve(json({ contextId: 'user:1', fields: [] }))
  }

afterEach(() => {
  restoreFetch()
  setCsrfToken('')
})

describe('TaskProviderSection', () => {
  test('renders provider-context fields only', async () => {
    setMockFetch(routeMock(boundInstancePayload))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(TaskProviderSection, { target, props: { contextId: 'user:1' } })
    await drain()
    expect(target.querySelector('[data-testid="cfg-row-kaneo_apikey"]')).not.toBeNull()
    expect(target.querySelector('[data-testid="cfg-row-timezone"]')).toBeNull()
    void unmount(component)
  })

  test('provision reveals one-time credentials', async () => {
    setCsrfToken('c')
    setMockFetch(routeMock(boundInstancePayload))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(TaskProviderSection, { target, props: { contextId: 'user:1' } })
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="provision-kaneo"]')!.click()
    await drain()
    expect(target.textContent).toContain('a@b.c')
    expect(target.textContent).toContain('p@ss')
    expect(target.textContent).toContain('https://k')
    void unmount(component)
  })

  test('renders refresh icon button and provision Btn', async () => {
    setMockFetch(routeMock(boundInstancePayload))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(TaskProviderSection, { target, props: { contextId: 'ctx' } })
    await drain()
    expect(target.querySelector('[data-testid="task-provider-refresh"]')).not.toBeNull()
    expect(target.querySelector('[data-testid="provision-kaneo"]')?.classList.contains('ui-btn')).toBe(true)
    void unmount(component)
  })

  test('shows the auto-provision section when the bound instance is provisionable', async () => {
    setMockFetch(routeMock(boundInstancePayload))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(TaskProviderSection, { target, props: { contextId: 'user:1' } })
    await drain()
    expect(target.querySelector('[data-testid="provision-kaneo"]')).not.toBeNull()
    expect(target.textContent).toContain('Kaneo auto-provision')
    void unmount(component)
  })

  test('hides the auto-provision section when the bound instance is not provisionable', async () => {
    setMockFetch(routeMock(boundNonProvisionablePayload, { contextId: 'user:1', fields: [] }))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(TaskProviderSection, { target, props: { contextId: 'user:1' } })
    await drain()
    expect(target.querySelector('[data-testid="provision-kaneo"]')).toBeNull()
    expect(target.textContent).not.toContain('Kaneo auto-provision')
    void unmount(component)
  })

  test('hides the auto-provision section when no instance is bound', async () => {
    setMockFetch(routeMock(unboundInstancePayload, { contextId: 'user:1', fields: [] }))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(TaskProviderSection, { target, props: { contextId: 'user:1' } })
    await drain()
    expect(target.querySelector('[data-testid="provision-kaneo"]')).toBeNull()
    void unmount(component)
  })

  test('renders section header via PageHeader', async () => {
    setMockFetch(routeMock(boundInstancePayload))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(TaskProviderSection, { target, props: { contextId: 'user:1' } })
    await drain()
    expect(target.querySelector('.ui-page-header__title')?.textContent).toContain('Task provider')
    void unmount(component)
  })

  test('shows the instance selector when no instance is bound', async () => {
    setMockFetch(routeMock(unboundInstancePayload, { contextId: 'user:1', fields: [] }))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(TaskProviderSection, { target, props: { contextId: 'user:1' } })
    await drain()
    expect(target.querySelector('[data-testid="context-task-instance"]')).not.toBeNull()
    void unmount(component)
  })

  test('shows an empty hint when no active instances are available', async () => {
    setMockFetch(routeMock(noInstancesPayload, { contextId: 'user:1', fields: [] }))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(TaskProviderSection, { target, props: { contextId: 'user:1' } })
    await drain()
    expect(target.querySelector('[data-testid="context-task-instance"]')).toBeNull()
    expect(target.textContent).toContain('No active task instances available')
    void unmount(component)
  })

  test('a failed load shows ErrorState with a working retry', async () => {
    setMockFetch(() => Promise.resolve(new Response('Internal Server Error', { status: 500 })))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(TaskProviderSection, { target, props: { contextId: 'user:1' } })
    await drain()
    expect(target.querySelector('.ui-error')).not.toBeNull()
    expect(target.querySelector('[data-testid="error-retry"]')).not.toBeNull()
    void unmount(component)
  })

  test('binding an instance PATCHes the context endpoint and re-fetches', async () => {
    setCsrfToken('c')
    const sink: { value: PatchRecord | null } = { value: null }
    setMockFetch(routeBindingMock(sink))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(TaskProviderSection, { target, props: { contextId: 'user:1' } })
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="context-task-instance-save"]')!.click()
    await drain()
    const patched = sink.value
    expect(patched).not.toBeNull()
    expect(patched!.method).toBe('PATCH')
    expect(JSON.parse(patched!.body)).toEqual({ taskInstanceId: 'yt-default', contextId: 'user:1' })
    void unmount(component)
  })
})
