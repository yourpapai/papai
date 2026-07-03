// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import { setCsrfToken } from '../../../../client/settings/fetchers.js'
import MemorySection from '../../../../client/settings/sections/MemorySection.svelte'
import { settingsSession } from '../../../../client/settings/session.svelte.js'
import SettingsApp from '../../../../client/settings/SettingsApp.svelte'
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

const userAMemoryPayload = {
  ...memoryPayload,
  contextId: 'user:a',
  profile: 'Profile from context A.',
  records: [{ ...memoryPayload.records[0], id: 'rec-a', summary: 'Record from context A.' }],
}

const userBMemoryPayload = {
  ...memoryPayload,
  contextId: 'user:b',
  profile: 'Profile from context B.',
  records: [{ ...memoryPayload.records[0], id: 'rec-b', summary: 'Record from context B.' }],
}

interface PendingMemoryState {
  resolveUserA: ((response: Response) => void) | null
}

const resetSession = (): void => {
  settingsSession.status = 'loading'
  settingsSession.display = ''
  settingsSession.isBotAdmin = false
  settingsSession.isSuperAdmin = false
  settingsSession.contexts = []
  settingsSession.activeContextId = ''
}

const seedTwoContextSession = (): void => {
  settingsSession.status = 'ready'
  settingsSession.display = 'alice'
  settingsSession.isBotAdmin = false
  settingsSession.isSuperAdmin = false
  settingsSession.contexts = [
    { kind: 'personal', contextId: 'user:a', label: 'Context A' },
    { kind: 'personal', contextId: 'user:b', label: 'Context B' },
  ]
  settingsSession.activeContextId = 'user:a'
}

const jsonForSettingsEndpoint = (url: string): Response => {
  const parsed = new URL(url, 'https://settings.invalid')
  const contextId = parsed.searchParams.get('contextId') ?? 'user:a'
  if (parsed.pathname.endsWith('/settings/api/config')) return json({ contextId, fields: [] })
  if (parsed.pathname.endsWith('/settings/api/context/task-instance'))
    return json({ contextId, taskInstanceId: null, available: [] })
  if (parsed.pathname.endsWith('/settings/api/tools')) return json({ contextId, domains: [] })
  if (parsed.pathname.endsWith('/settings/api/byok'))
    return json({ contextId, enabled: false, complete: false, missing: [], fields: [] })
  if (parsed.pathname.endsWith('/settings/api/identity'))
    return json({ contextId, providerName: 'provider', mapping: null })
  if (parsed.pathname.endsWith('/settings/api/mcp')) return json({ contextId, endpoints: [] })
  if (parsed.pathname.endsWith('/settings/api/plugins')) return json({ contextId, plugins: [] })
  return json({})
}

const routeSettingsWithMemory =
  (memory: (contextId: string) => Promise<Response>): ((url: string, init: RequestInit) => Promise<Response>) =>
  (url): Promise<Response> => {
    const parsed = new URL(url, 'https://settings.invalid')
    if (parsed.pathname.endsWith('/settings/api/memory')) return memory(parsed.searchParams.get('contextId') ?? '')
    return Promise.resolve(jsonForSettingsEndpoint(url))
  }

const pendingUserAMemory =
  (state: PendingMemoryState) =>
  (contextId: string): Promise<Response> => {
    if (contextId === 'user:a') {
      return new Promise<Response>((resolve) => {
        state.resolveUserA = resolve
      })
    }
    return Promise.resolve(json(userBMemoryPayload))
  }

const routeProfilePatchThenReloadFailure = (): ((url: string, init: RequestInit) => Promise<Response>) => {
  let memoryFetchCount = 0
  return (url): Promise<Response> => {
    if (url.startsWith('/settings/api/memory?')) {
      memoryFetchCount += 1
      if (memoryFetchCount === 1) return Promise.resolve(json(memoryPayload))
      return Promise.resolve(new Response('reload failed', { status: 500 }))
    }
    return Promise.resolve(json({ ok: true }))
  }
}

const routeClearFailure =
  (): ((url: string, init: RequestInit) => Promise<Response>) =>
  (url): Promise<Response> => {
    if (url === '/settings/api/memory/clear') return Promise.resolve(new Response('clear failed', { status: 500 }))
    if (url.startsWith('/settings/api/memory?')) return Promise.resolve(json(memoryPayload))
    return Promise.resolve(json({ ok: true }))
  }

afterEach(() => {
  restoreFetch()
  setCsrfToken('')
  resetSession()
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

  test('renders provisional records in a separate pending subsection', async () => {
    const payloadWithPending = {
      ...memoryPayload,
      records: [
        memoryPayload.records[0],
        {
          ...memoryPayload.records[1],
          id: 'rec-pending',
          status: 'provisional',
          summary: 'Pending provisional fact awaiting promotion.',
        },
      ],
    }
    setMockFetch(() => Promise.resolve(json(payloadWithPending)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(MemorySection, { target, props: { contextId: 'user:1' } })

    await drain()

    const pending = target.querySelector('[data-testid="memory-pending"]')
    expect(pending).not.toBeNull()
    expect(pending?.textContent).toContain('Pending (provisional)')
    expect(pending?.textContent).toContain('Pending provisional fact awaiting promotion.')
    // The active record must not be inside the pending subsection.
    expect(pending?.textContent).not.toContain('Prefers compact status updates.')
    // Provisional records are excluded from the active list / not treated as empty.
    expect(target.querySelector('[data-testid="memory-empty"]')).toBeNull()
    void unmount(component)
  })

  test('shows pending subsection even when there are no active records', async () => {
    const onlyPending = {
      ...emptyMemoryPayload,
      records: [
        {
          ...memoryPayload.records[0],
          id: 'rec-only-pending',
          status: 'provisional',
          summary: 'Only provisional records exist for this group.',
        },
      ],
    }
    setMockFetch(() => Promise.resolve(json(onlyPending)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(MemorySection, { target, props: { contextId: 'user:1' } })

    await drain()

    expect(target.querySelector('[data-testid="memory-empty"]')).not.toBeNull()
    const pending = target.querySelector('[data-testid="memory-pending"]')
    expect(pending).not.toBeNull()
    expect(pending?.textContent).toContain('Only provisional records exist for this group.')
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

  test('does not show success when profile reload fails after PATCH', async () => {
    setCsrfToken('c')
    setMockFetch(routeProfilePatchThenReloadFailure())
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(MemorySection, { target, props: { contextId: 'user:1' } })
    await drain()

    const input = target.querySelector<HTMLTextAreaElement>('[data-testid="memory-profile"]')!
    input.value = 'Updated pinned profile.'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    target.querySelector<HTMLButtonElement>('[data-testid="memory-profile-save"]')!.click()
    await drain()
    await drain()

    expect(target.querySelector('.status-error')).not.toBeNull()
    expect(target.querySelector('.status-success')).toBeNull()
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

  test('clear memory requires confirmation before POST and reloads after confirmation', async () => {
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

    expect(calls.find((call) => call.url === '/settings/api/memory/clear')).toBeUndefined()
    expect(target.textContent).toContain('Clear memory for this context')
    expect(target.textContent).toContain('memory profile and all memory records')

    const confirmButtons = Array.from(target.querySelectorAll<HTMLButtonElement>('button')).filter((button) =>
      button.textContent?.includes('Clear memory'),
    )
    const confirmButton = confirmButtons.at(-1)
    expect(confirmButton).not.toBeUndefined()
    confirmButton!.click()
    await drain()

    const write = calls.find((call) => call.url === '/settings/api/memory/clear')
    expect(write?.method).toBe('POST')
    expect(write?.body).toEqual({ contextId: 'user:1' })
    expect(calls.filter((call) => call.url.startsWith('/settings/api/memory?')).length).toBe(2)
    void unmount(component)
  })

  test('clear memory dialog stays open with inline error when the clear request fails', async () => {
    setCsrfToken('c')
    setMockFetch(routeClearFailure())
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(MemorySection, { target, props: { contextId: 'user:1' } })
    await drain()

    target.querySelector<HTMLButtonElement>('[data-testid="memory-clear"]')!.click()
    await drain()

    target.querySelector<HTMLButtonElement>('.modal .ui-btn--danger')!.click()
    await drain()

    expect(target.querySelector('.modal')).not.toBeNull()
    expect(target.querySelector('.modal .status-error')).not.toBeNull()
    void unmount(component)
  })

  test('stale slower load for old context does not overwrite newer context state', async () => {
    const pending: PendingMemoryState = { resolveUserA: null }
    setMockFetch(routeSettingsWithMemory(pendingUserAMemory(pending)))
    seedTwoContextSession()
    document.body.innerHTML = '<div id="root"></div>'
    history.replaceState(null, '', '/settings#memory')
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(SettingsApp, { target })

    await drain()
    settingsSession.activeContextId = 'user:b'
    await drain()
    expect(target.querySelector<HTMLTextAreaElement>('[data-testid="memory-profile"]')!.value).toBe(
      'Profile from context B.',
    )
    expect(target.textContent).toContain('Record from context B.')

    const resolveUserA = pending.resolveUserA
    expect(resolveUserA).not.toBeNull()
    resolveUserA!(json(userAMemoryPayload))
    await drain()

    expect(target.querySelector<HTMLTextAreaElement>('[data-testid="memory-profile"]')!.value).toBe(
      'Profile from context B.',
    )
    expect(target.textContent).toContain('Record from context B.')
    expect(target.textContent).not.toContain('Record from context A.')
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
