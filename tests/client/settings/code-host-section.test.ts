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

// Payload with kind select + instance_url + forge_token fields (A1 route shape)
const typedForgePayloadSaas = {
  namespace: 'forge',
  configured: true,
  complete: true,
  missing: [],
  fields: [
    {
      key: 'kind',
      label: 'Code host',
      required: true,
      sensitive: false,
      hasValue: true,
      value: 'github',
      control: 'select' as const,
      options: ['github', 'github-enterprise', 'gitlab', 'gitlab-self-hosted'],
    },
    {
      key: 'instance_url',
      label: 'Instance URL (enterprise / self-hosted)',
      required: false,
      sensitive: false,
      hasValue: false,
      value: '',
    },
    {
      key: 'forge_token',
      label: 'Access token',
      required: true,
      sensitive: true,
      hasValue: true,
      value: '****',
    },
  ],
}

const typedForgePayloadSelfHosted = {
  namespace: 'forge',
  configured: true,
  complete: true,
  missing: [],
  fields: [
    {
      key: 'kind',
      label: 'Code host',
      required: true,
      sensitive: false,
      hasValue: true,
      value: 'gitlab-self-hosted',
      control: 'select' as const,
      options: ['github', 'github-enterprise', 'gitlab', 'gitlab-self-hosted'],
    },
    {
      key: 'instance_url',
      label: 'Instance URL (enterprise / self-hosted)',
      required: false,
      sensitive: false,
      hasValue: true,
      value: 'https://gitlab.corp.com',
    },
    {
      key: 'forge_token',
      label: 'Access token',
      required: true,
      sensitive: true,
      hasValue: true,
      value: '****',
    },
  ],
}

// Unconfigured typed forge: kind select present (empty value), instance_url + token empty.
const typedForgeUnconfigured = {
  namespace: 'forge',
  configured: false,
  complete: false,
  missing: ['kind', 'forge_token'],
  fields: [
    {
      key: 'kind',
      label: 'Code host',
      required: true,
      sensitive: false,
      hasValue: false,
      value: '',
      control: 'select' as const,
      options: ['github', 'github-enterprise', 'gitlab', 'gitlab-self-hosted'],
    },
    {
      key: 'instance_url',
      label: 'Instance URL (enterprise / self-hosted)',
      required: false,
      sensitive: false,
      hasValue: false,
      value: '',
    },
    {
      key: 'forge_token',
      label: 'Access token',
      required: true,
      sensitive: true,
      hasValue: false,
      value: '',
    },
  ],
}

let capturedPatchBody = ''

const routeCodeHostMockUnconfigured = (_url: string, init?: RequestInit): Promise<Response> => {
  if (_url.includes('/settings/api/coding-credentials') && (init?.method ?? 'GET').toUpperCase() === 'PATCH') {
    capturedPatchBody = typeof init?.body === 'string' ? init.body : ''
    return Promise.resolve(json({ ok: true }))
  }
  return Promise.resolve(json(typedForgeUnconfigured))
}

const routeCodeHostMockSelfHosted = (_url: string, init?: RequestInit): Promise<Response> => {
  if (_url.includes('/settings/api/coding-credentials') && (init?.method ?? 'GET').toUpperCase() === 'PATCH') {
    capturedPatchBody = typeof init?.body === 'string' ? init.body : ''
    return Promise.resolve(json({ ok: true }))
  }
  return Promise.resolve(json(typedForgePayloadSelfHosted))
}

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
    target.querySelector<HTMLButtonElement>('[data-testid="code-host-save"]')!.click()
    await drain()

    expect(JSON.parse(capturedPatchBody)).toMatchObject({
      namespace: 'forge',
      contextId: 'pi:telegram:ctx:u1',
      values: { forge_token: 'ghp_secret' },
    })
    void unmount(component)
  })

  test('renders kind select with 4 options when field has control:select', async () => {
    setMockFetch(() => Promise.resolve(json(typedForgePayloadSaas)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodeHostSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

    await drain()

    const select = target.querySelector<HTMLSelectElement>('[data-testid="coding-select-kind"]')
    expect(select).not.toBeNull()
    expect(select!.options.length).toBe(4)
    expect(Array.from(select!.options).map((o) => o.value)).toEqual([
      'github',
      'github-enterprise',
      'gitlab',
      'gitlab-self-hosted',
    ])
    void unmount(component)
  })

  test('hides instance_url field for SaaS kind (github)', async () => {
    setMockFetch(() => Promise.resolve(json(typedForgePayloadSaas)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodeHostSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

    await drain()

    // instance_url field should not be visible when kind = 'github'
    expect(target.querySelector('[data-testid="coding-input-instance_url"]')).toBeNull()
    void unmount(component)
  })

  test('shows instance_url field for self-hosted kind (gitlab-self-hosted)', async () => {
    setMockFetch(() => Promise.resolve(json(typedForgePayloadSelfHosted)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodeHostSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

    await drain()

    // instance_url field should be visible when kind = 'gitlab-self-hosted'
    expect(target.querySelector('[data-testid="coding-input-instance_url"]')).not.toBeNull()
    void unmount(component)
  })

  test('renders token field masked (no plain text) when token is configured', async () => {
    setMockFetch(() => Promise.resolve(json(typedForgePayloadSaas)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodeHostSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

    await drain()

    // token should show Replace button (sensitive, hasValue=true, not in replace mode)
    expect(target.querySelector('[data-testid="coding-replace-forge_token"]')).not.toBeNull()
    // input for token should NOT be visible (not in replace mode)
    expect(target.querySelector('[data-testid="coding-input-forge_token"]')).toBeNull()
    void unmount(component)
  })

  test('changing the kind select does not PATCH on its own (whole-record save model)', async () => {
    setCsrfToken('csrf-t')
    setMockFetch(routeCodeHostMockUnconfigured)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodeHostSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

    await drain()

    const select = target.querySelector<HTMLSelectElement>('[data-testid="coding-select-kind"]')!
    select.value = 'gitlab-self-hosted'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await drain()

    // Selecting a kind must NOT auto-save — that is what produced the 422 deadlock
    // (kind needs instance_url present, which is entered afterwards).
    expect(capturedPatchBody).toBe('')
    void unmount(component)
  })

  test('saving a self-hosted forge persists kind + instance_url + token in one PATCH', async () => {
    setCsrfToken('csrf-t')
    setMockFetch(routeCodeHostMockUnconfigured)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodeHostSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

    await drain()

    const select = target.querySelector<HTMLSelectElement>('[data-testid="coding-select-kind"]')!
    select.value = 'gitlab-self-hosted'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    await drain()

    const instance = target.querySelector<HTMLInputElement>('[data-testid="coding-input-instance_url"]')!
    instance.value = 'https://gl.corp.com'
    instance.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    const token = target.querySelector<HTMLInputElement>('[data-testid="coding-input-forge_token"]')!
    token.value = 'glpat-1'
    token.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()

    target.querySelector<HTMLButtonElement>('[data-testid="code-host-save"]')!.click()
    await drain()

    expect(JSON.parse(capturedPatchBody)).toMatchObject({
      namespace: 'forge',
      contextId: 'pi:telegram:ctx:u1',
      values: { kind: 'gitlab-self-hosted', instance_url: 'https://gl.corp.com', forge_token: 'glpat-1' },
    })
    void unmount(component)
  })

  test('saving a configured forge omits the untouched masked token', async () => {
    setCsrfToken('csrf-t')
    setMockFetch(routeCodeHostMockSelfHosted)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodeHostSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

    await drain()

    // Token is configured (masked, Replace shown) and not being replaced; saving must
    // not send it (server preserves the existing secret).
    target.querySelector<HTMLButtonElement>('[data-testid="code-host-save"]')!.click()
    await drain()

    const parsed: unknown = JSON.parse(capturedPatchBody)
    expect(parsed).toMatchObject({ values: { kind: 'gitlab-self-hosted', instance_url: 'https://gitlab.corp.com' } })
    expect(parsed).not.toHaveProperty('values.forge_token')
    void unmount(component)
  })
})
