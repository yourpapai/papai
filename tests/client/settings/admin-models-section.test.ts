// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import { setCsrfToken } from '../../../client/settings/fetchers.js'
import AdminModelsSection from '../../../client/settings/sections/admin/AdminModelsSection.svelte'
import { restoreFetch, setMockFetch, waitFor } from '../../utils/test-helpers.js'

const json = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const providersPayload = {
  providers: [
    {
      id: 'prov_1',
      label: 'OpenAI',
      providerType: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKeyMasked: '****abcd',
      verification: {
        status: 'verified',
        error: null,
        at: null,
        models: ['gpt-4o', 'gpt-4o-mini'],
        modelsFetchedAt: null,
      },
    },
  ],
}
const rolesPayload = {
  roles: { main: { providerId: 'prov_1', model: 'gpt-4o' }, small: null, embedding: null },
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

/** Route the providers and llm-roles endpoints from a single fetch mock. */
const routeLlmFetch = (url: string): Promise<Response> => {
  if (url.includes('/settings/api/admin/providers')) return Promise.resolve(json(providersPayload))
  return Promise.resolve(json(rolesPayload))
}

/** Route the providers, llm-roles, and model-metadata endpoints from a single fetch mock. */
const routeFetch = (url: string): Promise<Response> => {
  if (url.includes('/settings/api/llm-model-metadata')) return Promise.resolve(json(metadataHitPayload))
  return routeLlmFetch(url)
}

const mainHint = (): Element | null =>
  document.querySelector('[data-testid="role-main"] [data-testid="model-metadata-hint"]')

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

describe('AdminModelsSection', () => {
  test('renders three role blocks', async () => {
    setMockFetch(routeLlmFetch)
    mount(AdminModelsSection, { target })
    await drain()

    expect(document.querySelector('[data-testid="role-main"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="role-small"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="role-embedding"]')).not.toBeNull()
  })

  test('main role block has no inherit checkbox', async () => {
    setMockFetch(routeLlmFetch)
    mount(AdminModelsSection, { target })
    await drain()

    expect(document.querySelector('[data-testid="role-main-inherit"]')).toBeNull()
  })

  test('small role shows inherit checkbox checked when null', async () => {
    setMockFetch(routeLlmFetch)
    mount(AdminModelsSection, { target })
    await drain()

    const checkbox = document.querySelector<HTMLInputElement>('[data-testid="role-small-inherit"]')
    expect(checkbox).not.toBeNull()
    expect(checkbox?.checked).toBe(true)
  })

  test('shows the model metadata hint under a role with a bound model', async () => {
    setMockFetch(routeFetch)
    mount(AdminModelsSection, { target })
    await drain()

    await waitFor(() => {
      flushSync()
      return mainHint() !== null
    })
    expect(mainHint()?.textContent).toContain('models.dev · openai/gpt-4o')
    expect(mainHint()?.textContent).toContain('ctx 128000')
    expect(mainHint()?.textContent).toContain('max out 16384')
  })

  test('hides the metadata hint when the model field is cleared', async () => {
    setMockFetch(routeFetch)
    mount(AdminModelsSection, { target })
    await drain()
    await waitFor(() => {
      flushSync()
      return mainHint() !== null
    })

    const modelInput = document.querySelector<HTMLInputElement>('[data-testid="role-main-model"]')!
    modelInput.value = ''
    modelInput.dispatchEvent(new Event('input', { bubbles: true }))

    await waitFor(() => {
      flushSync()
      return mainHint() === null
    })
  })
})
