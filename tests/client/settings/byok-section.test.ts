// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import { setCsrfToken } from '../../../client/settings/fetchers.js'
import ByokSection from '../../../client/settings/sections/ByokSection.svelte'
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

let capturedPatchBody = ''

const routeByokMock = (url: string, init?: RequestInit): Promise<Response> => {
  if (url.includes('/settings/api/byok') && (init?.method ?? 'GET') === 'PATCH') {
    capturedPatchBody = typeof init?.body === 'string' ? init.body : ''
    return Promise.resolve(json({ ok: true }))
  }
  return Promise.resolve(json(enabledPayload))
}

afterEach(() => {
  capturedPatchBody = ''
  restoreFetch()
  setCsrfToken('')
})

describe('ByokSection', () => {
  test('shows a disabled placeholder when BYOK is not enabled', async () => {
    setMockFetch(() => Promise.resolve(json(disabledPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ByokSection, { target, props: { contextId: 'user:1' } })

    await drain()

    expect(target.querySelector('#byok')).not.toBeNull()
    expect(target.textContent).toContain('BYOK is not enabled')
    void unmount(component)
  })

  test('renders enabled fields with a masked API key and no raw secret text', async () => {
    setMockFetch(() => Promise.resolve(json(enabledPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ByokSection, { target, props: { contextId: 'user:1' } })

    await drain()

    expect(target.textContent).toContain('LLM API key')
    expect(target.textContent).toContain('LLM base URL')
    expect(target.textContent).toContain('Main model')
    expect(target.textContent).toContain('Small model')
    expect(target.textContent).toContain('Embedding model')
    expect(target.textContent).toContain('••••1234')
    expect(target.textContent).toContain('Replace')
    expect(target.textContent).not.toContain('sk-test-raw-secret')
    expect(target.querySelector('[data-testid="byok-input-llm_apikey"]')).toBeNull()
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
})
