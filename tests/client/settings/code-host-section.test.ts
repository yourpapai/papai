// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import { setCsrfToken } from '../../../client/settings/fetchers.js'
import CodeHostSection from '../../../client/settings/sections/CodeHostSection.svelte'
import { restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

const json = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const unconfiguredPayload = {
  namespace: 'forge',
  configured: false,
  complete: false,
  missing: ['forge_token'],
  fields: [
    {
      key: 'forge_token',
      label: 'Code-host token',
      required: true,
      sensitive: true,
      hasValue: false,
      value: '',
    },
  ],
}

const configuredPayload = {
  namespace: 'forge',
  configured: true,
  complete: true,
  missing: [],
  fields: [
    {
      key: 'forge_token',
      label: 'Code-host token',
      required: true,
      sensitive: true,
      hasValue: true,
      value: '****',
    },
  ],
}

let capturedPatchBody = ''

const routeCodeHostMock = (_url: string, init?: RequestInit): Promise<Response> => {
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

describe('CodeHostSection', () => {
  test('renders the forge_token field input when unconfigured', async () => {
    setMockFetch(() => Promise.resolve(json(unconfiguredPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodeHostSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

    await drain()

    expect(target.querySelector('[data-testid="coding-input-forge_token"]')).not.toBeNull()
    void unmount(component)
  })

  test('renders the section with id code-host and code-host-refresh testid', async () => {
    setMockFetch(() => Promise.resolve(json(unconfiguredPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodeHostSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

    await drain()

    expect(target.querySelector('#code-host')).not.toBeNull()
    expect(target.querySelector('[data-testid="code-host-refresh"]')).not.toBeNull()
    void unmount(component)
  })

  test('shows Replace button and no input for configured sensitive field', async () => {
    setMockFetch(() => Promise.resolve(json(configuredPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodeHostSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

    await drain()

    expect(target.querySelector('[data-testid="coding-replace-forge_token"]')).not.toBeNull()
    expect(target.querySelector('[data-testid="coding-input-forge_token"]')).toBeNull()
    void unmount(component)
  })

  test('fetches with forge namespace and PATCHes with forge namespace', async () => {
    setCsrfToken('csrf-t')
    setMockFetch(routeCodeHostMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodeHostSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

    await drain()
    const input = target.querySelector<HTMLInputElement>('[data-testid="coding-input-forge_token"]')!
    input.value = 'ghp_secret'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="coding-save-forge_token"]')!.click()
    await drain()

    expect(JSON.parse(capturedPatchBody)).toMatchObject({
      namespace: 'forge',
      contextId: 'pi:telegram:ctx:u1',
      values: { forge_token: 'ghp_secret' },
    })
    void unmount(component)
  })
})
