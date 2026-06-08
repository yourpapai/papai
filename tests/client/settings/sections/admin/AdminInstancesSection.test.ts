// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import { setCsrfToken } from '../../../../../client/settings/fetchers.js'
import AdminInstancesSection from '../../../../../client/settings/sections/admin/AdminInstancesSection.svelte'
import { restoreFetch, setMockFetch } from '../../../../utils/test-helpers.js'

const json = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 12; i++) await Promise.resolve()
  flushSync()
}

const requestMethod = (init?: RequestInit): string => {
  if (init?.method === undefined) return 'GET'
  return init.method
}

const responseFor = (responses: ReadonlyMap<string, Response>, call: string): Response => {
  const response = responses.get(call)
  if (response === undefined) return json({})
  return response
}

const installFetch = (): void => {
  setMockFetch((url) => {
    if (url.includes('/admin/platform-instances'))
      return Promise.resolve(
        json({ instances: [{ id: 'tg', type: 'telegram', status: 'active', config: {}, createdAt: 1 }] }),
      )
    if (url.includes('/admin/task-instances'))
      return Promise.resolve(
        json({ instances: [{ id: 'k', type: 'kaneo', status: 'active', config: {}, createdAt: 1 }] }),
      )
    if (url.includes('/admin/platform-provider-types'))
      return Promise.resolve(
        json({ providerTypes: [{ type: 'telegram', displayName: 'Telegram', instanceConfigSchema: [] }] }),
      )
    if (url.includes('/admin/task-provider-types'))
      return Promise.resolve(
        json({ providerTypes: [{ type: 'kaneo', displayName: 'Kaneo', instanceConfigSchema: [] }] }),
      )
    return Promise.resolve(json({}))
  })
}

afterEach(() => {
  restoreFetch()
  setCsrfToken('')
})

const mockFetchWithCreateFailure = (url: string, init?: RequestInit): Promise<Response> => {
  const method = (init?.method ?? 'GET').toUpperCase()
  if (method === 'POST' && url.includes('/admin/platform-instances'))
    return Promise.resolve(new Response('Internal Server Error', { status: 500 }))
  if (url.includes('/admin/platform-instances'))
    return Promise.resolve(
      json({ instances: [{ id: 'tg', type: 'telegram', status: 'active', config: {}, createdAt: 1 }] }),
    )
  if (url.includes('/admin/task-instances'))
    return Promise.resolve(
      json({ instances: [{ id: 'kaneo', type: 'kaneo', status: 'active', config: {}, createdAt: 1 }] }),
    )
  if (url.includes('/admin/platform-provider-types'))
    return Promise.resolve(
      json({ providerTypes: [{ type: 'telegram', displayName: 'Telegram', instanceConfigSchema: [] }] }),
    )
  if (url.includes('/admin/task-provider-types'))
    return Promise.resolve(json({ providerTypes: [{ type: 'kaneo', displayName: 'Kaneo', instanceConfigSchema: [] }] }))
  return Promise.resolve(json({}))
}

const createPlatformStatusMock = (onPatch: () => void) => {
  const responses = new Map<string, Response>([
    [
      'GET /settings/api/admin/platform-instances',
      json({ instances: [{ id: 'tg', type: 'telegram', status: 'active', config: {}, createdAt: 1 }] }),
    ],
    [
      'GET /settings/api/admin/task-instances',
      json({ instances: [{ id: 'k', type: 'kaneo', status: 'active', config: {}, createdAt: 1 }] }),
    ],
    [
      'GET /settings/api/admin/platform-provider-types',
      json({ providerTypes: [{ type: 'telegram', displayName: 'Telegram', instanceConfigSchema: [] }] }),
    ],
    [
      'GET /settings/api/admin/task-provider-types',
      json({ providerTypes: [{ type: 'kaneo', displayName: 'Kaneo', instanceConfigSchema: [] }] }),
    ],
    ['PATCH /settings/api/admin/platform-instances/tg', json({ ok: true, id: 'tg' })],
  ])

  return (url: string, init?: RequestInit): Promise<Response> => {
    const call = `${requestMethod(init)} ${url}`
    if (call === 'PATCH /settings/api/admin/platform-instances/tg') onPatch()
    return Promise.resolve(responseFor(responses, call))
  }
}

const createTaskStatusMock = (onPatch: () => void) => {
  const responses = new Map<string, Response>([
    [
      'GET /settings/api/admin/platform-instances',
      json({ instances: [{ id: 'tg', type: 'telegram', status: 'active', config: {}, createdAt: 1 }] }),
    ],
    [
      'GET /settings/api/admin/task-instances',
      json({ instances: [{ id: 'k', type: 'kaneo', status: 'active', config: {}, createdAt: 1 }] }),
    ],
    [
      'GET /settings/api/admin/platform-provider-types',
      json({ providerTypes: [{ type: 'telegram', displayName: 'Telegram', instanceConfigSchema: [] }] }),
    ],
    [
      'GET /settings/api/admin/task-provider-types',
      json({ providerTypes: [{ type: 'kaneo', displayName: 'Kaneo', instanceConfigSchema: [] }] }),
    ],
    ['PATCH /settings/api/admin/task-instances/k', json({ ok: true, id: 'k' })],
  ])

  return (url: string, init?: RequestInit): Promise<Response> => {
    const call = `${requestMethod(init)} ${url}`
    if (call === 'PATCH /settings/api/admin/task-instances/k') onPatch()
    return Promise.resolve(responseFor(responses, call))
  }
}

const extractStringBody = (init: RequestInit): string => (typeof init.body === 'string' ? init.body : '')

const createTaskStorageKeyMock = (onCreate: (body: string) => void) => {
  const responses = new Map<string, Response>([
    [
      'GET /settings/api/admin/platform-instances',
      json({ instances: [{ id: 'tg', type: 'telegram', status: 'active', config: {}, createdAt: 1 }], unreadable: [] }),
    ],
    [
      'GET /settings/api/admin/task-instances',
      json({ instances: [{ id: 'k', type: 'kaneo', status: 'active', config: {}, createdAt: 1 }], unreadable: [] }),
    ],
    [
      'GET /settings/api/admin/platform-provider-types',
      json({ providerTypes: [{ type: 'telegram', displayName: 'Telegram', instanceConfigSchema: [] }] }),
    ],
    [
      'GET /settings/api/admin/task-provider-types',
      json({
        providerTypes: [
          {
            type: 'kaneo',
            displayName: 'Kaneo',
            instanceConfigSchema: [
              { key: 'baseUrl', storageKey: 'tracker_url', label: 'Base URL', required: true, sensitive: false },
            ],
          },
        ],
      }),
    ],
    ['POST /settings/api/admin/task-instances', json({ ok: true, id: 'kaneo-new' })],
  ])

  return (url: string, init?: RequestInit): Promise<Response> => {
    const call = `${requestMethod(init)} ${url}`
    if (call === 'POST /settings/api/admin/task-instances') {
      onCreate(init === undefined ? '' : extractStringBody(init))
    }
    return Promise.resolve(responseFor(responses, call))
  }
}

const createProviderTypeFailureMock = () => {
  const responses = new Map<string, Response>([
    [
      'GET /settings/api/admin/platform-instances',
      json({ instances: [{ id: 'tg', type: 'telegram', status: 'active', config: {}, createdAt: 1 }], unreadable: [] }),
    ],
    [
      'GET /settings/api/admin/task-instances',
      json({ instances: [{ id: 'k', type: 'kaneo', status: 'active', config: {}, createdAt: 1 }], unreadable: [] }),
    ],
    [
      'GET /settings/api/admin/platform-provider-types',
      json({ providerTypes: [{ type: 'telegram', displayName: 'Telegram', instanceConfigSchema: [] }] }),
    ],
    ['GET /settings/api/admin/task-provider-types', new Response('provider types unavailable', { status: 500 })],
  ])

  return (url: string, init?: RequestInit): Promise<Response> => {
    const call = `${requestMethod(init)} ${url}`
    return Promise.resolve(responseFor(responses, call))
  }
}

const createUnreadableDiagnosticsMock = () => {
  const responses = new Map<string, Response>([
    [
      'GET /settings/api/admin/platform-instances',
      json({
        instances: [{ id: 'tg', type: 'telegram', status: 'active', config: {}, createdAt: 1 }],
        unreadable: [{ table: 'platform_instances', id: 'pi-broken', type: 'telegram', error: 'Encrypted payload' }],
      }),
    ],
    [
      'GET /settings/api/admin/task-instances',
      json({
        instances: [{ id: 'k', type: 'kaneo', status: 'active', config: {}, createdAt: 1 }],
        unreadable: [{ table: 'task_instances', id: 'ti-broken', type: 'kaneo', error: 'Encrypted payload' }],
      }),
    ],
    [
      'GET /settings/api/admin/platform-provider-types',
      json({ providerTypes: [{ type: 'telegram', displayName: 'Telegram', instanceConfigSchema: [] }] }),
    ],
    [
      'GET /settings/api/admin/task-provider-types',
      json({ providerTypes: [{ type: 'kaneo', displayName: 'Kaneo', instanceConfigSchema: [] }] }),
    ],
  ])

  return (url: string, init?: RequestInit): Promise<Response> => {
    const call = `${requestMethod(init)} ${url}`
    return Promise.resolve(responseFor(responses, call))
  }
}

const createDeleteMock = (onDelete: (url: string) => void) => {
  return (url: string, init?: RequestInit): Promise<Response> => {
    const method = requestMethod(init)
    if (method === 'DELETE') {
      onDelete(url)
      return Promise.resolve(json({ ok: true }))
    }
    if (url.includes('/admin/platform-instances'))
      return Promise.resolve(
        json({ instances: [{ id: 'tg', type: 'telegram', status: 'active', config: {}, createdAt: 1 }] }),
      )
    if (url.includes('/admin/task-instances'))
      return Promise.resolve(
        json({ instances: [{ id: 'k', type: 'kaneo', status: 'active', config: {}, createdAt: 1 }] }),
      )
    if (url.includes('/admin/platform-provider-types'))
      return Promise.resolve(
        json({ providerTypes: [{ type: 'telegram', displayName: 'Telegram', instanceConfigSchema: [] }] }),
      )
    if (url.includes('/admin/task-provider-types'))
      return Promise.resolve(
        json({ providerTypes: [{ type: 'kaneo', displayName: 'Kaneo', instanceConfigSchema: [] }] }),
      )
    return Promise.resolve(json({}))
  }
}

describe('AdminInstancesSection', () => {
  test('renders platform and task instance rows', async () => {
    installFetch()
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminInstancesSection, { target })
    await drain()
    expect(target.querySelector('#instances')).not.toBeNull()
    expect(target.textContent).toContain('tg')
    expect(target.textContent).toContain('kaneo')
    void unmount(component)
  })

  test('a failed create keeps the tables visible and shows an error', async () => {
    setCsrfToken('c')
    setMockFetch(mockFetchWithCreateFailure)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminInstancesSection, { target })
    await drain()
    const platformIdInput = target.querySelector<HTMLInputElement>('[data-testid="platform-id"]')!
    platformIdInput.value = 'new-tg'
    platformIdInput.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    const form = platformIdInput.closest('form')!
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await drain()
    expect(target.querySelector('.status-error')).not.toBeNull()
    expect(target.textContent).toContain('tg')
    void unmount(component)
  })

  test('renders a task status button and stop is confirm-gated: no PATCH until modal confirmed', async () => {
    setCsrfToken('c')
    let taskPatchSeen = false
    setMockFetch(
      createTaskStatusMock(() => {
        taskPatchSeen = true
      }),
    )

    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminInstancesSection, { target })
    await drain()

    // click Stop on active instance — no PATCH yet
    target.querySelector<HTMLButtonElement>('[data-testid="task-status-k"]')!.click()
    flushSync()
    expect(taskPatchSeen).toBe(false)

    // confirm via the modal danger button
    target.querySelector<HTMLButtonElement>('.modal .ui-btn--danger')!.click()
    await drain()

    expect(taskPatchSeen).toBe(true)
    void unmount(component)
  })

  test('stopping a platform instance is confirm-gated: no PATCH until modal confirmed', async () => {
    setCsrfToken('c')
    let platformPatchSeen = false
    setMockFetch(
      createPlatformStatusMock(() => {
        platformPatchSeen = true
      }),
    )

    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminInstancesSection, { target })
    await drain()

    // click Stop on active platform instance — no PATCH yet
    target.querySelector<HTMLButtonElement>('[data-testid="platform-status-tg"]')!.click()
    flushSync()
    expect(platformPatchSeen).toBe(false)

    // confirm via the modal danger button
    target.querySelector<HTMLButtonElement>('.modal .ui-btn--danger')!.click()
    await drain()

    expect(platformPatchSeen).toBe(true)
    void unmount(component)
  })

  test('creates task instances using storageKey when present', async () => {
    setCsrfToken('c')
    let createBody = ''
    setMockFetch(
      createTaskStorageKeyMock((body) => {
        createBody = body
      }),
    )

    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminInstancesSection, { target })
    await drain()

    const taskIdInput = target.querySelector<HTMLInputElement>('[data-testid="task-id"]')!
    taskIdInput.value = 'kaneo-new'
    taskIdInput.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()

    const taskConfigInput = target.querySelectorAll<HTMLInputElement>('input')[2]!
    taskConfigInput.value = 'https://kaneo.invalid'
    taskConfigInput.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()

    taskIdInput.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await drain()

    expect(createBody).toBe(
      JSON.stringify({ id: 'kaneo-new', type: 'kaneo', config: { tracker_url: 'https://kaneo.invalid' } }),
    )
    void unmount(component)
  })

  test('keeps instance rows visible when a provider types request fails', async () => {
    setMockFetch(createProviderTypeFailureMock())
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminInstancesSection, { target })

    await drain()

    expect(target.textContent).toContain('tg')
    expect(target.textContent).toContain('k')
    expect(target.querySelector('.status-error')).not.toBeNull()
    void unmount(component)
  })

  test('shows unreadable instance diagnostics from list responses', async () => {
    setMockFetch(createUnreadableDiagnosticsMock())
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminInstancesSection, { target })

    await drain()

    expect(target.querySelector('[data-testid="platform-unreadable"]')?.textContent).toContain('pi-broken')
    expect(target.querySelector('[data-testid="task-unreadable"]')?.textContent).toContain('ti-broken')
    void unmount(component)
  })

  test('renders section header via PageHeader', async () => {
    installFetch()
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminInstancesSection, { target })
    await drain()
    expect(target.querySelector('.ui-page-header__title')?.textContent).toContain('Instances')
    void unmount(component)
  })

  test('renders forms via Field/Input/Select/Btn and tables via DataTable with StatusPill', async () => {
    installFetch()
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminInstancesSection, { target })
    await drain()
    expect(target.querySelector('[data-testid="platform-id"]')?.closest('.ui-input')).not.toBeNull()
    expect(target.querySelector('.ui-select')).not.toBeNull()
    expect(target.querySelector('.ui-datatable')).not.toBeNull()
    expect(target.querySelector('.ui-pill')).not.toBeNull()
    expect(target.querySelector('[data-testid="platform-status-tg"]')?.classList.contains('ui-btn')).toBe(true)
    void unmount(component)
  })

  test('separates the add-instance card from the instances table', async () => {
    // The instanceColumns include { label: 'Status' } which DataTable renders as a <th>.
    // The create card has only ID/Type field labels and the + Create button — no Status column header.
    // We assert the card exists, has its own create button, and does NOT contain the 'Status' table header.
    installFetch()
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const c = mount(AdminInstancesSection, { target })
    await drain()
    expect(target.querySelector('[data-testid="platform-create-card"]')).not.toBeNull()
    expect(target.querySelector('[data-testid="platform-create"]')).not.toBeNull()
    const card = target.querySelector('[data-testid="platform-create-card"]')!
    expect(card.textContent).not.toContain('Status')
    void unmount(c)
  })

  test('deleting a platform instance requires confirmation before DELETE fires', async () => {
    setCsrfToken('c')
    let deletedUrl: string | undefined
    setMockFetch(
      createDeleteMock((url) => {
        deletedUrl = url
      }),
    )
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminInstancesSection, { target })
    await drain()
    // click Delete — no DELETE yet
    target.querySelector<HTMLButtonElement>('[data-testid="platform-delete-tg"]')!.click()
    flushSync()
    expect(deletedUrl).toBeUndefined()
    // confirm via the modal danger button
    target.querySelector<HTMLButtonElement>('.modal .ui-btn--danger')!.click()
    await drain()
    expect(deletedUrl).toContain('tg')
    void unmount(component)
  })

  test('deleting a task instance requires confirmation before DELETE fires', async () => {
    setCsrfToken('c')
    let deletedUrl: string | undefined
    setMockFetch(
      createDeleteMock((url) => {
        deletedUrl = url
      }),
    )
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminInstancesSection, { target })
    await drain()
    // click Delete — no DELETE yet
    target.querySelector<HTMLButtonElement>('[data-testid="task-delete-k"]')!.click()
    flushSync()
    expect(deletedUrl).toBeUndefined()
    // confirm via the modal danger button
    target.querySelector<HTMLButtonElement>('.modal .ui-btn--danger')!.click()
    await drain()
    expect(deletedUrl).toContain('k')
    void unmount(component)
  })
})
