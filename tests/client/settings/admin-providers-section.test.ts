// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import { setCsrfToken } from '../../../client/settings/fetchers.js'
import AdminProvidersSection from '../../../client/settings/sections/admin/AdminProvidersSection.svelte'
import { restoreFetch, setMockFetch, waitFor } from '../../utils/test-helpers.js'

const json = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

interface CapturedCall {
  url: string
  method: string
}

const captureCall = (calls: CapturedCall[], url: string, init: RequestInit): void => {
  calls.push({ url, method: init.method ?? 'GET' })
}

const findCall = (calls: CapturedCall[], fragment: string): CapturedCall | undefined =>
  calls.find((c) => c.url.includes(fragment))

const populatedPayload = {
  providers: [
    {
      id: 'prov_1',
      label: 'OpenAI',
      providerType: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKeyMasked: '****abcd',
      baseProvider: 'openai',
      baseModel: 'gpt-4o',
      verification: {
        status: 'verified',
        error: null,
        at: 1717000000000,
        models: ['gpt-4o'],
        modelsFetchedAt: 1717000000000,
      },
    },
  ],
}

const metadataHitPayload = {
  providerId: 'openai',
  modelId: 'gpt-4o',
  contextWindow: 128_000,
  maxOutputTokens: 16_384,
  source: 'models-dev',
  via: 'inferred',
  snapshotFetchedAt: 1_700_000_000_000,
}

interface CapturedRequest {
  url: string
  method: string
  body: string
}

const metadataRoute = (url: string): boolean => url.includes('/settings/api/llm-model-metadata')

const patchRejectsRoute =
  (payload: unknown, status: number) =>
  (url: string, init?: RequestInit): Promise<Response> => {
    void url
    if (init?.method === 'PATCH') return Promise.resolve(json({ error: 'invalid request body' }, status))
    return Promise.resolve(json(payload))
  }

const setInput = (testid: string, value: string): void => {
  const input = document.querySelector<HTMLInputElement>(`[data-testid="${testid}"]`)!
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

const formHint = (): Element | null =>
  document.querySelector('[data-testid="provider-form"] [data-testid="model-metadata-hint"]')

const routeProvidersWithMetadata =
  (payload: unknown) =>
  (url: string, init?: RequestInit): Promise<Response> => {
    if (metadataRoute(url)) return Promise.resolve(json(metadataHitPayload))
    void init
    return Promise.resolve(json(payload))
  }

const recordingRoute =
  (calls: CapturedRequest[], payload: unknown, withMetadata: boolean) =>
  (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? init.body : '',
    })
    if (withMetadata && metadataRoute(url)) return Promise.resolve(json(metadataHitPayload))
    return Promise.resolve(json(payload))
  }

let target: HTMLElement

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(() => {
  void unmount(target)
  target.remove()
  restoreFetch()
  setCsrfToken('')
})

describe('AdminProvidersSection', () => {
  test('renders the provider list', async () => {
    setMockFetch(() => Promise.resolve(json(populatedPayload)))
    mount(AdminProvidersSection, { target })
    await drain()

    expect(document.body.textContent).toContain('OpenAI')
    expect(document.body.textContent).toContain('****abcd')
  })

  test('shows add-provider form on button click', async () => {
    setMockFetch(() => Promise.resolve(json(populatedPayload)))
    mount(AdminProvidersSection, { target })
    await drain()

    const addBtn = document.querySelector<HTMLButtonElement>('[data-testid="admin-providers-add"]')!
    addBtn.click()
    await drain()

    expect(document.querySelector('[data-testid="provider-form-type"]')).not.toBeNull()
  })

  test('shows empty state when no providers', async () => {
    setMockFetch(() => Promise.resolve(json({ providers: [] })))
    mount(AdminProvidersSection, { target })
    await drain()

    expect(document.body.textContent).toContain('No providers')
  })

  test('renders error state', async () => {
    setMockFetch(() => Promise.resolve(json({ error: 'boom' }, 500)))
    mount(AdminProvidersSection, { target })
    await drain()

    expect(document.body.textContent).toContain('boom')
  })

  test('shows edit form in edit mode on edit button click', async () => {
    setMockFetch(() => Promise.resolve(json(populatedPayload)))
    mount(AdminProvidersSection, { target })
    await drain()

    const editBtn = document.querySelector<HTMLButtonElement>('[data-testid="admin-providers-edit-prov_1"]')!
    editBtn.click()
    await drain()

    expect(document.querySelector('[data-testid="provider-edit-form"]')).not.toBeNull()
    const labelInput = document.querySelector<HTMLInputElement>('[data-testid="provider-edit-form-label"]')!
    expect(labelInput.value).toBe('OpenAI')
  })

  test('refresh-models button triggers refresh-models fetch', async () => {
    const calls: CapturedCall[] = []
    setMockFetch((url, init) => {
      captureCall(calls, url, init)
      return Promise.resolve(json(populatedPayload))
    })
    mount(AdminProvidersSection, { target })
    await drain()

    const refreshBtn = document.querySelector<HTMLButtonElement>(
      '[data-testid="admin-providers-refresh-models-prov_1"]',
    )!
    refreshBtn.click()
    await drain()

    expect(findCall(calls, '/providers/prov_1/refresh-models')?.method).toBe('POST')
  })

  test('shows models editor textarea on models button click', async () => {
    setMockFetch(() => Promise.resolve(json(populatedPayload)))
    mount(AdminProvidersSection, { target })
    await drain()

    const modelsBtn = document.querySelector<HTMLButtonElement>('[data-testid="admin-providers-models-prov_1"]')!
    modelsBtn.click()
    await drain()

    const textarea = document.querySelector<HTMLTextAreaElement>('[data-testid="provider-models-prov_1-textarea"]')!
    expect(textarea).not.toBeNull()
    expect(textarea.value).toBe('gpt-4o')
  })

  test('the add form exposes optional base-reference fields with a pre-save hint', async () => {
    setMockFetch(routeProvidersWithMetadata(populatedPayload))
    mount(AdminProvidersSection, { target })
    await drain()

    document.querySelector<HTMLButtonElement>('[data-testid="admin-providers-add"]')!.click()
    await drain()

    expect(document.querySelector('[data-testid="provider-form-base-provider"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="provider-form-base-model"]')).not.toBeNull()

    setInput('provider-form-base-model', 'gpt-4o')
    await waitFor(() => {
      flushSync()
      return formHint() !== null
    })
    expect(formHint()?.textContent).toContain('models.dev · openai/gpt-4o')
  })

  test('saving with base references sends them in the create payload', async () => {
    const calls: CapturedRequest[] = []
    setMockFetch(recordingRoute(calls, populatedPayload, true))
    mount(AdminProvidersSection, { target })
    await drain()

    document.querySelector<HTMLButtonElement>('[data-testid="admin-providers-add"]')!.click()
    await drain()
    setInput('provider-form-label', 'OpenAI work')
    setInput('provider-form-api-key', 'sk-x')
    setInput('provider-form-base-provider', 'openai')
    setInput('provider-form-base-model', 'gpt-4o')
    flushSync()

    document.querySelector<HTMLButtonElement>('[data-testid="provider-form-save"]')!.click()
    await drain()

    const created = calls.find((call) => call.method === 'POST')
    expect(created).not.toBeUndefined()
    expect(JSON.parse(created!.body)).toMatchObject({ baseProvider: 'openai', baseModel: 'gpt-4o' })
  })

  test('the edit form prefills base references and patches them', async () => {
    const calls: CapturedRequest[] = []
    setMockFetch(recordingRoute(calls, populatedPayload, false))
    mount(AdminProvidersSection, { target })
    await drain()

    document.querySelector<HTMLButtonElement>('[data-testid="admin-providers-edit-prov_1"]')!.click()
    await drain()

    const baseProvider = document.querySelector<HTMLInputElement>('[data-testid="provider-edit-form-base-provider"]')!
    expect(baseProvider.value).toBe('openai')
    expect(document.querySelector<HTMLInputElement>('[data-testid="provider-edit-form-base-model"]')!.value).toBe(
      'gpt-4o',
    )

    setInput('provider-edit-form-base-model', 'gpt-4o-mini')
    document.querySelector<HTMLButtonElement>('[data-testid="provider-edit-form-save"]')!.click()
    await drain()

    const patched = calls.find((call) => call.method === 'PATCH')
    expect(patched).not.toBeUndefined()
    expect(JSON.parse(patched!.body)).toMatchObject({ baseModel: 'gpt-4o-mini' })
  })

  const HINTS = { 'gpt-4o': { baseProvider: 'openai', baseModel: 'gpt-4o' } }
  const baseFixture = populatedPayload.providers[0]!
  const hintsPayload = {
    providers: [
      {
        ...baseFixture,
        modelHints: HINTS,
        verification: { ...baseFixture.verification, models: ['gpt-4o', 'gpt-4o-mini'] },
      },
    ],
  }

  const setElementValue = (input: HTMLInputElement, value: string): void => {
    input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }

  test('the edit form renders the hints editor with the enumerated models and stored hints', async () => {
    setMockFetch(recordingRoute([], hintsPayload, true))
    mount(AdminProvidersSection, { target })
    await drain()

    document.querySelector<HTMLButtonElement>('[data-testid="admin-providers-edit-prov_1"]')!.click()
    await drain()

    const editor = document.querySelector('[data-testid="provider-edit-form"] [data-testid="model-hints-editor"]')
    expect(editor).not.toBeNull()
    const row = [...document.querySelectorAll('[data-testid="model-hints-row"]')].find((candidate) =>
      candidate.textContent?.includes('gpt-4o'),
    )
    expect(row).toBeDefined()
    expect(row!.querySelector<HTMLInputElement>('[data-testid="model-hints-base-provider"]')!.value).toBe('openai')
    expect(row!.querySelector<HTMLInputElement>('[data-testid="model-hints-base-model"]')!.value).toBe('gpt-4o')
    const select = document.querySelector<HTMLSelectElement>('[data-testid="model-hints-add-model"]')!
    expect([...select.options].map((option) => option.value)).toStrictEqual(['gpt-4o-mini'])
  })

  test('saving the edit form carries modelHints in the PATCH body', async () => {
    const calls: CapturedRequest[] = []
    setMockFetch(recordingRoute(calls, hintsPayload, true))
    mount(AdminProvidersSection, { target })
    await drain()

    document.querySelector<HTMLButtonElement>('[data-testid="admin-providers-edit-prov_1"]')!.click()
    await drain()
    const row = [...document.querySelectorAll('[data-testid="model-hints-row"]')].find((candidate) =>
      candidate.textContent?.includes('gpt-4o'),
    )!
    setElementValue(row.querySelector<HTMLInputElement>('[data-testid="model-hints-base-model"]')!, 'gpt-4o-turbo')
    flushSync()

    document.querySelector<HTMLButtonElement>('[data-testid="provider-edit-form-save"]')!.click()
    await drain()

    const patched = calls.find((call) => call.method === 'PATCH')
    expect(patched).not.toBeUndefined()
    expect(JSON.parse(patched!.body)).toMatchObject({
      modelHints: { 'gpt-4o': { baseProvider: 'openai', baseModel: 'gpt-4o-turbo' } },
    })
  })

  test('an incomplete hint row disables saving until the hint is filled', async () => {
    setMockFetch(recordingRoute([], hintsPayload, true))
    mount(AdminProvidersSection, { target })
    await drain()

    document.querySelector<HTMLButtonElement>('[data-testid="admin-providers-edit-prov_1"]')!.click()
    await drain()
    expect(document.querySelector('[data-testid="provider-edit-form-error"]')).toBeNull()

    const select = document.querySelector<HTMLSelectElement>('[data-testid="model-hints-add-model"]')!
    select.value = 'gpt-4o-mini'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await drain()

    const save = document.querySelector<HTMLButtonElement>('[data-testid="provider-edit-form-save"]')!
    expect(save.disabled).toBe(true)

    const row = [...document.querySelectorAll('[data-testid="model-hints-row"]')].find((candidate) =>
      candidate.textContent?.includes('gpt-4o-mini'),
    )!
    setElementValue(row.querySelector<HTMLInputElement>('[data-testid="model-hints-base-provider"]')!, 'openai')
    setElementValue(row.querySelector<HTMLInputElement>('[data-testid="model-hints-base-model"]')!, 'gpt-4o-mini')
    flushSync()

    expect(save.disabled).toBe(false)
  })

  test('a rejected edit save surfaces the server error next to the form', async () => {
    setMockFetch(patchRejectsRoute(hintsPayload, 422))
    mount(AdminProvidersSection, { target })
    await drain()

    document.querySelector<HTMLButtonElement>('[data-testid="admin-providers-edit-prov_1"]')!.click()
    await drain()
    document.querySelector<HTMLButtonElement>('[data-testid="provider-edit-form-save"]')!.click()
    await drain()

    const surfaced = document.querySelector('[data-testid="provider-edit-form-error"]')
    expect(surfaced).not.toBeNull()
    expect(surfaced!.textContent).toContain('invalid request body')
    expect(document.querySelector('[data-testid="provider-edit-form"]')).not.toBeNull()
  })

  test('the create form does not render the hints editor', async () => {
    setMockFetch(routeProvidersWithMetadata(populatedPayload))
    mount(AdminProvidersSection, { target })
    await drain()

    document.querySelector<HTMLButtonElement>('[data-testid="admin-providers-add"]')!.click()
    await drain()

    expect(document.querySelector('[data-testid="provider-form"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="model-hints-editor"]')).toBeNull()
  })
})
