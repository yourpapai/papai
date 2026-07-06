// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import { setCsrfToken } from '../../../client/settings/fetchers.js'
import ByokSection from '../../../client/settings/sections/ByokSection.svelte'
import { settingsSession } from '../../../client/settings/session.svelte.js'
import SettingsApp from '../../../client/settings/SettingsApp.svelte'
import { restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

const json = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const disabledPayload = { enabled: false, complete: false, missing: [], fields: [] }

const enabledPayload = {
  enabled: true,
  complete: false,
  missing: ['embedding_model'],
  fields: [
    { key: 'llm_apikey', label: 'LLM API key', required: true, sensitive: true, hasValue: true, value: '****1234' },
    {
      key: 'llm_baseurl',
      label: 'LLM base URL',
      required: true,
      sensitive: false,
      hasValue: true,
      value: 'https://llm.invalid/v1',
    },
    { key: 'main_model', label: 'Main model', required: true, sensitive: false, hasValue: true, value: 'gpt-main' },
    { key: 'small_model', label: 'Small model', required: false, sensitive: false, hasValue: false, value: '' },
    { key: 'embedding_model', label: 'Embedding model', required: false, sensitive: false, hasValue: false, value: '' },
  ],
}

const rawSecretPayload = {
  enabled: true,
  complete: true,
  missing: [],
  fields: [
    {
      key: 'llm_apikey',
      label: 'LLM API key',
      required: true,
      sensitive: true,
      hasValue: true,
      value: 'sk-test-raw-secret',
    },
  ],
}

const unreadablePayload = {
  enabled: true,
  complete: false,
  missing: ['llm_apikey', 'llm_baseurl', 'main_model'],
  unreadable: true,
  error: 'stored BYOK LLM credentials are unreadable',
  fields: [],
}

let capturedPatchBody = ''

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
  if (parsed.pathname.endsWith('/settings/api/identity'))
    return json({ contextId, providerName: 'provider', mapping: null })
  if (parsed.pathname.endsWith('/settings/api/mcp')) return json({ contextId, endpoints: [] })
  if (parsed.pathname.endsWith('/settings/api/plugins')) return json({ contextId, plugins: [] })
  return json({})
}

const routeSettingsWithByok =
  (
    byok: (contextId: string) => Promise<Response>,
    onPatch: (body: unknown) => void = () => {},
  ): ((url: string, init?: RequestInit) => Promise<Response>) =>
  (url, init): Promise<Response> => {
    const method = (init?.method ?? 'GET').toUpperCase()
    if (method === 'PATCH') {
      onPatch(typeof init?.body === 'string' ? JSON.parse(init.body) : null)
      return Promise.resolve(json({ ok: true }))
    }
    const parsed = new URL(url, 'https://settings.invalid')
    if (parsed.pathname.endsWith('/settings/api/byok')) return byok(parsed.searchParams.get('contextId') ?? '')
    return Promise.resolve(jsonForSettingsEndpoint(url))
  }

interface PendingByokState {
  requestedContext: string
  resolveSecondLoad: ((response: Response) => void) | null
}

const pendingUserBByok =
  (state: PendingByokState) =>
  (contextId: string): Promise<Response> => {
    state.requestedContext = contextId
    if (contextId === 'user:b') {
      return new Promise<Response>((resolve) => {
        state.resolveSecondLoad = resolve
      })
    }
    return Promise.resolve(json(enabledPayload))
  }

const failUserBByok = (contextId: string): Promise<Response> =>
  contextId === 'user:b'
    ? Promise.resolve(new Response('failed to load BYOK', { status: 500 }))
    : Promise.resolve(json(enabledPayload))

const routeByokMock = (url: string, init?: RequestInit): Promise<Response> => {
  if (url.includes('/settings/api/byok') && (init?.method ?? 'GET') === 'PATCH') {
    capturedPatchBody = typeof init?.body === 'string' ? init.body : ''
    return Promise.resolve(json({ ok: true }))
  }
  return Promise.resolve(json(enabledPayload))
}

interface ToggleMockState {
  payload: unknown
}

const makeToggleMock =
  (state: ToggleMockState, postPatchPayload: unknown) =>
  (url: string, init?: RequestInit): Promise<Response> => {
    if (url.includes('/settings/api/byok') && (init?.method ?? 'GET') === 'PATCH') {
      capturedPatchBody = typeof init?.body === 'string' ? init.body : ''
      state.payload = postPatchPayload
      return Promise.resolve(json({ ok: true }))
    }
    return Promise.resolve(json(state.payload))
  }

interface ReloadFailState {
  getCount: number
}

const makeReloadFailsByokMock =
  (state: ReloadFailState) =>
  (url: string, init?: RequestInit): Promise<Response> => {
    const method = (init?.method ?? 'GET').toUpperCase()
    if (url.includes('/settings/api/byok') && method === 'PATCH') return Promise.resolve(json({ ok: true }))
    state.getCount++
    if (state.getCount === 1) return Promise.resolve(json(enabledPayload))
    return Promise.resolve(new Response('reload failed', { status: 500 }))
  }

afterEach(() => {
  capturedPatchBody = ''
  resetSession()
  restoreFetch()
  setCsrfToken('')
})

describe('ByokSection', () => {
  test('shows a disabled state with no field editor and an enable toggle', async () => {
    setMockFetch(() => Promise.resolve(json(disabledPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ByokSection, { target, props: { contextId: 'user:1' } })

    await drain()

    expect(target.querySelector('#byok')).not.toBeNull()
    expect(target.querySelector('[data-testid="byok-toggle"]')).not.toBeNull()
    expect(target.querySelector('[data-testid="byok-input-llm_apikey"]')).toBeNull()
    expect(target.textContent).toContain('central')
    void unmount(component)
  })

  test('enabling the toggle PATCHes an enable action', async () => {
    setCsrfToken('c')
    setMockFetch(makeToggleMock({ payload: disabledPayload }, enabledPayload))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ByokSection, { target, props: { contextId: 'user:1' } })

    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="byok-toggle"]')!.click()
    // two drains: setEnabled awaits toggleByok then load
    await drain()
    await drain()

    expect(capturedPatchBody).toBe(JSON.stringify({ contextId: 'user:1', action: 'enable' }))
    expect(target.querySelector('[data-testid="byok-input-small_model"]')).not.toBeNull()
    void unmount(component)
  })

  test('disabling the toggle PATCHes a disable action', async () => {
    setCsrfToken('c')
    setMockFetch(makeToggleMock({ payload: enabledPayload }, disabledPayload))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ByokSection, { target, props: { contextId: 'user:1' } })

    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="byok-toggle"]')!.click()
    // two drains: setEnabled awaits toggleByok then load
    await drain()
    await drain()

    expect(capturedPatchBody).toBe(JSON.stringify({ contextId: 'user:1', action: 'disable' }))
    expect(target.querySelector('[data-testid="byok-input-small_model"]')).toBeNull()
    void unmount(component)
  })

  test('renders enabled fields with a masked API key and no raw secret text', async () => {
    setMockFetch(() => Promise.resolve(json(rawSecretPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ByokSection, { target, props: { contextId: 'user:1' } })

    await drain()

    expect(target.textContent).toContain('LLM API key')
    expect(target.textContent).toContain('••••••••')
    expect(target.textContent).toContain('Replace')
    expect(target.textContent).not.toContain('sk-test-raw-secret')
    expect(target.querySelector('[data-testid="byok-input-llm_apikey"]')).toBeNull()
    void unmount(component)
  })

  test('clears previous context fields during a context switch load', async () => {
    const pending: PendingByokState = { requestedContext: '', resolveSecondLoad: null }
    setMockFetch(routeSettingsWithByok(pendingUserBByok(pending)))
    seedTwoContextSession()
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    history.replaceState(null, '', '/settings#byok')
    const component = mount(SettingsApp, { target })

    await drain()
    expect(target.querySelector('[data-testid="byok-save-main_model"]')).not.toBeNull()
    settingsSession.activeContextId = 'user:b'
    await drain()

    const staleSaveVisible = target.querySelector('[data-testid="byok-save-main_model"]') !== null
    const loadingVisible = target.textContent.includes('Loading…')
    const resolveLoad = pending.resolveSecondLoad
    expect(resolveLoad).not.toBeNull()
    resolveLoad!(json(disabledPayload))
    await drain()
    expect(pending.requestedContext).toBe('user:b')
    expect(staleSaveVisible).toBe(false)
    expect(loadingVisible).toBe(true)
    void unmount(component)
  })

  test('failed context switch does not PATCH the new context with a stale draft', async () => {
    setCsrfToken('c')
    let capturedPatch: unknown = null
    setMockFetch(
      routeSettingsWithByok(failUserBByok, (body) => {
        capturedPatch = body
      }),
    )
    seedTwoContextSession()
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    history.replaceState(null, '', '/settings#byok')
    const component = mount(SettingsApp, { target })

    await drain()
    const input = target.querySelector<HTMLInputElement>('[data-testid="byok-input-main_model"]')!
    input.value = 'stale-main-model'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    settingsSession.activeContextId = 'user:b'
    await drain()

    expect(target.textContent).toContain('request failed with status 500')
    expect(target.querySelector('[data-testid="byok-save-main_model"]')).toBeNull()
    expect(capturedPatch).toBeNull()
    void unmount(component)
  })

  test('shows missing required fields for incomplete BYOK credentials', async () => {
    setMockFetch(() => Promise.resolve(json(enabledPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ByokSection, { target, props: { contextId: 'user:1' } })

    await drain()

    expect(target.textContent).toContain('Missing required fields')
    expect(target.textContent).toContain('embedding_model')
    void unmount(component)
  })

  test('shows unreadable credential state distinctly', async () => {
    setMockFetch(() => Promise.resolve(json(unreadablePayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ByokSection, { target, props: { contextId: 'user:1' } })

    await drain()

    expect(target.textContent).toContain('Stored BYOK credentials are unreadable')
    expect(target.textContent).not.toContain('not-base64')
    void unmount(component)
  })

  test('saving a local value PATCHes the single changed key', async () => {
    setCsrfToken('c')
    setMockFetch(routeByokMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ByokSection, { target, props: { contextId: 'user:1' } })

    await drain()
    const input = target.querySelector<HTMLInputElement>('[data-testid="byok-input-main_model"]')!
    input.value = 'gpt-next'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="byok-save-main_model"]')!.click()
    await drain()

    expect(capturedPatchBody).toBe(JSON.stringify({ contextId: 'user:1', values: { main_model: 'gpt-next' } }))
    void unmount(component)
  })

  test('shows a mute "Central credentials" state pill when disabled', async () => {
    setMockFetch(() => Promise.resolve(json(disabledPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ByokSection, { target, props: { contextId: 'user:1' } })
    await drain()
    const pill = target.querySelector('[data-testid="byok-state"]')
    expect(pill).not.toBeNull()
    expect(pill!.textContent).toContain('Central credentials')
    void unmount(component)
  })

  test('shows an "Incomplete" state pill when required fields are missing', async () => {
    setMockFetch(() => Promise.resolve(json(enabledPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ByokSection, { target, props: { contextId: 'user:1' } })
    await drain()
    expect(target.querySelector('[data-testid="byok-state"]')!.textContent).toContain('Incomplete')
    void unmount(component)
  })

  test('shows an "Active" state pill when enabled and complete', async () => {
    setMockFetch(() => Promise.resolve(json(rawSecretPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ByokSection, { target, props: { contextId: 'user:1' } })
    await drain()
    expect(target.querySelector('[data-testid="byok-state"]')!.textContent).toContain('Active')
    void unmount(component)
  })

  test('a per-field Save is disabled until the value changes', async () => {
    setMockFetch(() => Promise.resolve(json(enabledPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ByokSection, { target, props: { contextId: 'user:1' } })
    await drain()
    const save = target.querySelector<HTMLButtonElement>('[data-testid="byok-save-main_model"]')!
    expect(save.disabled).toBe(true)
    const input = target.querySelector<HTMLInputElement>('[data-testid="byok-input-main_model"]')!
    input.value = 'gpt-next'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    expect(save.disabled).toBe(false)
    void unmount(component)
  })

  test('a field input has an accessible name via aria-labelledby pointing at its label', async () => {
    setMockFetch(() => Promise.resolve(json(enabledPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ByokSection, { target, props: { contextId: 'user:1' } })
    await drain()
    const input = target.querySelector<HTMLInputElement>('[data-testid="byok-input-main_model"]')!
    const labelledBy = input.getAttribute('aria-labelledby')
    expect(labelledBy).not.toBeNull()
    const labelEl = target.querySelector(`#${labelledBy}`)
    expect(labelEl).not.toBeNull()
    expect(labelEl!.textContent).toContain('Main model')
    void unmount(component)
  })

  test('a failed initial load renders ErrorState with a retry control', async () => {
    setMockFetch(() => Promise.resolve(new Response('boom', { status: 500 })))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ByokSection, { target, props: { contextId: 'user:1' } })
    await drain()
    expect(target.querySelector('[data-testid="error-retry"]')).not.toBeNull()
    expect(target.querySelector('.ui-error')).not.toBeNull()
    void unmount(component)
  })

  test('a save success line is announced via role="status"', async () => {
    setCsrfToken('c')
    setMockFetch(routeByokMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ByokSection, { target, props: { contextId: 'user:1' } })
    await drain()
    const input = target.querySelector<HTMLInputElement>('[data-testid="byok-input-main_model"]')!
    input.value = 'gpt-next'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="byok-save-main_model"]')!.click()
    // two drains: save() awaits patchByok then load()
    await drain()
    await drain()
    expect(target.querySelector('p[role="status"]')).not.toBeNull()
    void unmount(component)
  })

  test('a save whose reload fails shows the error and no success line', async () => {
    setCsrfToken('c')
    setMockFetch(makeReloadFailsByokMock({ getCount: 0 }))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ByokSection, { target, props: { contextId: 'user:1' } })
    await drain()
    const input = target.querySelector<HTMLInputElement>('[data-testid="byok-input-main_model"]')!
    input.value = 'gpt-next'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="byok-save-main_model"]')!.click()
    await drain()
    await drain()
    expect(target.querySelector('p[role="status"]')).toBeNull()
    expect(target.querySelector('p.status-error[role="alert"]')).not.toBeNull()
    void unmount(component)
  })
})
