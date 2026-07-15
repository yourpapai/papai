// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import { setCsrfToken } from '../../../client/settings/fetchers.js'
import ByokSection from '../../../client/settings/sections/ByokSection.svelte'
import { restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

const json = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const disabledPayload = {
  enabled: false,
  complete: false,
  missing: [],
  fields: [],
}

const enabledWithProviderPayload = {
  enabled: true,
  complete: true,
  missing: [],
  fields: [],
  providers: [
    {
      id: 'prov_1',
      label: 'OpenAI',
      providerType: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKeyMasked: '••••••••',
      verification: {
        status: 'verified',
        error: null,
        at: 1717000000000,
        models: ['gpt-4o'],
        modelsFetchedAt: 1717000000000,
      },
    },
  ],
  roles: {
    main: { providerId: 'prov_1', model: 'gpt-4o' },
    small: null,
    embedding: null,
  },
}

const enabledNoProvidersPayload = {
  enabled: true,
  complete: false,
  missing: [],
  fields: [],
  providers: [],
  roles: { main: { providerId: '', model: '' }, small: null, embedding: null },
}

const unreadablePayload = {
  enabled: true,
  complete: false,
  missing: [],
  unreadable: true,
  error: 'stored BYOK LLM credentials are unreadable',
  fields: [],
}

interface MockState {
  current: unknown
  afterPatch: unknown
  patchBodies: string[]
}

const byokMock =
  (state: MockState) =>
  (url: string, init?: RequestInit): Promise<Response> => {
    const method = (init?.method ?? 'GET').toUpperCase()
    if (url.includes('/settings/api/byok') && method === 'PATCH') {
      state.patchBodies.push(typeof init?.body === 'string' ? init.body : '')
      state.current = state.afterPatch ?? state.current
      return Promise.resolve(json({ ok: true }))
    }
    return Promise.resolve(json(state.current))
  }

let target: HTMLElement
let component: ReturnType<typeof mount> | null = null

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  component = null
})

afterEach(() => {
  if (component !== null) void unmount(component)
  target.remove()
  restoreFetch()
  setCsrfToken('')
})

const mountSection = (contextId = 'user:1'): ReturnType<typeof mount> => {
  component = mount(ByokSection, { target, props: { contextId } })
  return component
}

describe('ByokSection', () => {
  test('renders a disabled state with central-credentials text and an enable toggle', async () => {
    setMockFetch(() => Promise.resolve(json(disabledPayload)))
    mountSection()
    await drain()

    const toggle = target.querySelector<HTMLButtonElement>('[data-testid="byok-toggle"]')!
    expect(toggle).not.toBeNull()
    expect(toggle.textContent).toContain('Use my own credentials')
    expect(target.textContent).toContain('Using the central LLM credentials')
    // No provider editor in disabled state.
    expect(target.querySelector('[data-testid="byok-add-provider"]')).toBeNull()
    const pill = target.querySelector('[data-testid="byok-state"]')
    expect(pill).not.toBeNull()
    expect(pill!.textContent).toContain('Central credentials')
  })

  test('renders enabled state with provider label, masked key, and verification pill', async () => {
    setMockFetch(() => Promise.resolve(json(enabledWithProviderPayload)))
    mountSection()
    await drain()

    expect(target.textContent).toContain('OpenAI')
    expect(target.textContent).toContain('••••••••')
    const pill = target.querySelector('[data-testid="verification-pill"]')
    expect(pill).not.toBeNull()
    expect(pill!.textContent).toContain('Verified')
    expect(target.querySelector('[data-testid="byok-delete-prov_1"]')).not.toBeNull()
    // Role override blocks render.
    expect(target.querySelector('[data-testid="byok-role-main"]')).not.toBeNull()
    expect(target.querySelector('[data-testid="byok-role-small"]')).not.toBeNull()
    expect(target.querySelector('[data-testid="byok-role-embedding"]')).not.toBeNull()
    // The masked value is shown but no raw API key leaks.
    expect(target.textContent).not.toContain('sk-test-raw-secret')
    const statePill = target.querySelector('[data-testid="byok-state"]')
    expect(statePill!.textContent).toContain('Active')
  })

  test('renders enabled state without providers with an empty-state message and warn pill', async () => {
    setMockFetch(() => Promise.resolve(json(enabledNoProvidersPayload)))
    mountSection()
    await drain()

    expect(target.textContent).toContain('No providers configured')
    expect(target.querySelector('[data-testid="byok-delete-prov_1"]')).toBeNull()
    const statePill = target.querySelector('[data-testid="byok-state"]')
    expect(statePill!.textContent).toContain('No providers')
  })

  test('shows the add-provider form when the Add provider button is clicked', async () => {
    setMockFetch(() => Promise.resolve(json(enabledWithProviderPayload)))
    mountSection()
    await drain()

    expect(target.querySelector('[data-testid="byok-add-form"]')).toBeNull()
    target.querySelector<HTMLButtonElement>('[data-testid="byok-add-provider"]')!.click()
    await drain()

    expect(target.querySelector('[data-testid="byok-add-form"]')).not.toBeNull()
    expect(target.querySelector('[data-testid="byok-provider-form-type"]')).not.toBeNull()
    expect(target.querySelector('[data-testid="byok-provider-form-label"]')).not.toBeNull()
    expect(target.querySelector('[data-testid="byok-provider-form-api-key"]')).not.toBeNull()
    // Add button is hidden while the form is open.
    expect(target.querySelector('[data-testid="byok-add-provider"]')).toBeNull()
  })

  test('enabling the toggle PATCHes an enable action and reloads the provider list', async () => {
    setCsrfToken('c')
    const state: MockState = {
      current: disabledPayload,
      afterPatch: enabledWithProviderPayload,
      patchBodies: [],
    }
    setMockFetch(byokMock(state))
    mountSection()
    await drain()

    target.querySelector<HTMLButtonElement>('[data-testid="byok-toggle"]')!.click()
    // Two drains: setEnabled awaits toggleByok then load.
    await drain()
    await drain()

    expect(state.patchBodies).toEqual([JSON.stringify({ contextId: 'user:1', action: 'enable' })])
    // After reload, the enabled provider UI is shown.
    expect(target.textContent).toContain('OpenAI')
    const toggle = target.querySelector<HTMLButtonElement>('[data-testid="byok-toggle"]')!
    expect(toggle.textContent).toContain('Use central credentials')
  })

  test('disabling the toggle PATCHes a disable action and reloads', async () => {
    setCsrfToken('c')
    const state: MockState = {
      current: enabledWithProviderPayload,
      afterPatch: disabledPayload,
      patchBodies: [],
    }
    setMockFetch(byokMock(state))
    mountSection()
    await drain()

    target.querySelector<HTMLButtonElement>('[data-testid="byok-toggle"]')!.click()
    await drain()
    await drain()

    expect(state.patchBodies).toEqual([JSON.stringify({ contextId: 'user:1', action: 'disable' })])
    expect(target.textContent).toContain('Using the central LLM credentials')
  })

  test('submitting the add-provider form PATCHes an upsert-provider action', async () => {
    setCsrfToken('c')
    const state: MockState = {
      current: enabledWithProviderPayload,
      afterPatch: enabledWithProviderPayload,
      patchBodies: [],
    }
    setMockFetch(byokMock(state))
    mountSection()
    await drain()

    target.querySelector<HTMLButtonElement>('[data-testid="byok-add-provider"]')!.click()
    await drain()

    const label = target.querySelector<HTMLInputElement>('[data-testid="byok-provider-form-label"]')!
    label.value = 'My provider'
    label.dispatchEvent(new Event('input', { bubbles: true }))
    const apiKey = target.querySelector<HTMLInputElement>('[data-testid="byok-provider-form-api-key"]')!
    apiKey.value = 'sk-test'
    apiKey.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()

    target.querySelector<HTMLButtonElement>('[data-testid="byok-provider-form-save"]')!.click()
    // Two drains: onAddProvider awaits upsertByokProviderAction then load.
    await drain()
    await drain()

    expect(state.patchBodies.length).toBe(1)
    const raw = state.patchBodies[0]!
    // The provider id is random, so assert on the stable fields rather than the full body.
    expect(raw).toContain('"contextId":"user:1"')
    expect(raw).toContain('"action":"upsert-provider"')
    expect(raw).toContain('"label":"My provider"')
    expect(raw).toContain('"apiKey":"sk-test"')
  })

  test('shows a distinct unreadable state with a danger pill', async () => {
    setMockFetch(() => Promise.resolve(json(unreadablePayload)))
    mountSection()
    await drain()

    expect(target.textContent).toContain('Stored BYOK credentials are unreadable')
    expect(target.textContent).not.toContain('not-base64')
    const statePill = target.querySelector('[data-testid="byok-state"]')
    expect(statePill!.textContent).toContain('Unreadable')
  })

  test('clicking the refresh-models button PATCHes a refresh-models action and reloads', async () => {
    setCsrfToken('c')
    const state: MockState = {
      current: enabledWithProviderPayload,
      afterPatch: enabledWithProviderPayload,
      patchBodies: [],
    }
    setMockFetch(byokMock(state))
    mountSection()
    await drain()

    target.querySelector<HTMLButtonElement>('[data-testid="byok-refresh-models-prov_1"]')!.click()
    // Two drains: refreshProviderModels awaits refreshByokModels then load.
    await drain()
    await drain()

    expect(state.patchBodies).toEqual([JSON.stringify({ contextId: 'user:1', action: 'refresh-models', id: 'prov_1' })])
  })

  test('the Save roles button is disabled until the role bindings change', async () => {
    setMockFetch(() => Promise.resolve(json(enabledWithProviderPayload)))
    mountSection()
    await drain()

    const save = target.querySelector<HTMLButtonElement>('[data-testid="byok-roles-save"]')!
    expect(save.disabled).toBe(true)
  })

  test('a failed initial load renders ErrorState with a retry control', async () => {
    setMockFetch(() => Promise.resolve(new Response('boom', { status: 500 })))
    mountSection()
    await drain()

    expect(target.querySelector('[data-testid="error-retry"]')).not.toBeNull()
    expect(target.querySelector('.ui-error')).not.toBeNull()
  })
})
