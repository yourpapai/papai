// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import { setCsrfToken } from '../../../client/settings/fetchers.js'
import CodingCredentialsSection from '../../../client/settings/sections/CodingCredentialsSection.svelte'
import { restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

const json = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const configuredPayload = {
  namespace: 'agent-provider',
  configured: true,
  complete: true,
  missing: [],
  fields: [
    {
      key: 'provider_api_key',
      label: 'Anthropic API Key',
      required: true,
      sensitive: true,
      hasValue: true,
      value: '****',
    },
    {
      key: 'provider_base_url',
      label: 'Anthropic Base URL (optional)',
      required: false,
      sensitive: false,
      hasValue: false,
      value: '',
    },
  ],
}

const unconfiguredPayload = {
  namespace: 'agent-provider',
  configured: false,
  complete: false,
  missing: ['provider_api_key'],
  fields: [
    {
      key: 'provider_api_key',
      label: 'Anthropic API Key',
      required: true,
      sensitive: true,
      hasValue: false,
      value: '',
    },
    {
      key: 'provider_base_url',
      label: 'Anthropic Base URL (optional)',
      required: false,
      sensitive: false,
      hasValue: false,
      value: '',
    },
  ],
}

let capturedPatchBody = ''

const routeCodingMock = (_url: string, init?: RequestInit): Promise<Response> => {
  if (_url.includes('/settings/api/coding-credentials') && (init?.method ?? 'GET').toUpperCase() === 'PATCH') {
    capturedPatchBody = typeof init?.body === 'string' ? init.body : ''
    return Promise.resolve(json({ ok: true }))
  }
  return Promise.resolve(json(unconfiguredPayload))
}

afterEach(() => {
  capturedPatchBody = ''
  restoreFetch()
  setCsrfToken('')
})

describe('CodingCredentialsSection', () => {
  test('renders the Anthropic API key field input when unconfigured', async () => {
    setMockFetch(() => Promise.resolve(json(unconfiguredPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodingCredentialsSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

    await drain()

    expect(target.querySelector('[data-testid="coding-input-provider_api_key"]')).not.toBeNull()
    void unmount(component)
  })

  test('renders the section with id coding-credentials', async () => {
    setMockFetch(() => Promise.resolve(json(unconfiguredPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodingCredentialsSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

    await drain()

    expect(target.querySelector('#coding-credentials')).not.toBeNull()
    void unmount(component)
  })

  test('shows Replace button and no input for configured sensitive field', async () => {
    setMockFetch(() => Promise.resolve(json(configuredPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodingCredentialsSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

    await drain()

    expect(target.querySelector('[data-testid="coding-replace-provider_api_key"]')).not.toBeNull()
    expect(target.querySelector('[data-testid="coding-input-provider_api_key"]')).toBeNull()
    void unmount(component)
  })

  test('saves a value by PATCHing the single field', async () => {
    setCsrfToken('csrf-t')
    setMockFetch(routeCodingMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodingCredentialsSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

    await drain()
    const input = target.querySelector<HTMLInputElement>('[data-testid="coding-input-provider_api_key"]')!
    input.value = 'sk-ant-test'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="coding-save-provider_api_key"]')!.click()
    await drain()

    expect(JSON.parse(capturedPatchBody)).toEqual({
      contextId: 'pi:telegram:ctx:u1',
      values: { provider_api_key: 'sk-ant-test' },
    })
    void unmount(component)
  })
})
