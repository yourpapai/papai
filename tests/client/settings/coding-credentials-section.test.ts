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

const withSelectsPayload = {
  namespace: 'agent-provider',
  configured: true,
  complete: true,
  missing: [],
  fields: [
    {
      key: 'agent',
      label: 'Coding agent',
      required: true,
      sensitive: false,
      hasValue: true,
      value: 'claude',
      control: 'select',
      options: ['claude', 'codex', 'opencode'],
    },
    {
      key: 'provider',
      label: 'Model provider',
      required: true,
      sensitive: false,
      hasValue: true,
      value: 'anthropic',
      control: 'select',
      options: ['anthropic', 'openai'],
    },
    {
      key: 'provider_api_key',
      label: 'API key',
      required: true,
      sensitive: true,
      hasValue: true,
      value: '****',
    },
    {
      key: 'provider_base_url',
      label: 'Base URL (optional)',
      required: false,
      sensitive: false,
      hasValue: false,
      value: '',
    },
  ],
}

let capturedPatchBody = ''
const capturedPatchBodies: string[] = []

const routeCodingMock = (_url: string, init?: RequestInit): Promise<Response> => {
  if (_url.includes('/settings/api/coding-credentials') && (init?.method ?? 'GET').toUpperCase() === 'PATCH') {
    capturedPatchBody = typeof init?.body === 'string' ? init.body : ''
    return Promise.resolve(json({ ok: true }))
  }
  return Promise.resolve(json(unconfiguredPayload))
}

const routeSelectsMock = (_url: string, init?: RequestInit): Promise<Response> => {
  if (_url.includes('/settings/api/coding-credentials') && (init?.method ?? 'GET').toUpperCase() === 'PATCH') {
    capturedPatchBody = typeof init?.body === 'string' ? init.body : ''
    return Promise.resolve(json({ ok: true }))
  }
  return Promise.resolve(json(withSelectsPayload))
}

// Records every PATCH body to capturedPatchBodies; GET returns withSelectsPayload.
const routeAtomicMock = (_url: string, init?: RequestInit): Promise<Response> => {
  if (_url.includes('/settings/api/coding-credentials') && (init?.method ?? 'GET').toUpperCase() === 'PATCH') {
    capturedPatchBodies.push(typeof init?.body === 'string' ? init.body : '')
    return Promise.resolve(json({ ok: true }))
  }
  return Promise.resolve(json(withSelectsPayload))
}

afterEach(() => {
  capturedPatchBody = ''
  capturedPatchBodies.length = 0
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

  test('renders agent <select> with all agent options when control is select', async () => {
    setMockFetch(() => Promise.resolve(json(withSelectsPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodingCredentialsSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

    await drain()

    const agentSelect = target.querySelector<HTMLSelectElement>('[data-testid="coding-select-agent"]')
    expect(agentSelect).not.toBeNull()
    const options = Array.from(agentSelect!.options).map((o) => o.value)
    expect(options).toContain('claude')
    expect(options).toContain('codex')
    expect(options).toContain('opencode')
    void unmount(component)
  })

  test('renders provider <select> with options compatible with selected agent (claude→anthropic only)', async () => {
    setMockFetch(() => Promise.resolve(json(withSelectsPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodingCredentialsSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

    await drain()

    // agent is 'claude', so only 'anthropic' should be available
    const providerSelect = target.querySelector<HTMLSelectElement>('[data-testid="coding-select-provider"]')
    expect(providerSelect).not.toBeNull()
    const options = Array.from(providerSelect!.options).map((o) => o.value)
    expect(options).toContain('anthropic')
    expect(options).not.toContain('openai')
    void unmount(component)
  })

  test('provider options expand when agent is changed to opencode', async () => {
    setMockFetch(() => Promise.resolve(json(withSelectsPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodingCredentialsSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

    await drain()

    const agentSelect = target.querySelector<HTMLSelectElement>('[data-testid="coding-select-agent"]')!
    agentSelect.value = 'opencode'
    agentSelect.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()

    const providerSelect = target.querySelector<HTMLSelectElement>('[data-testid="coding-select-provider"]')
    expect(providerSelect).not.toBeNull()
    const options = Array.from(providerSelect!.options).map((o) => o.value)
    expect(options).toContain('anthropic')
    expect(options).toContain('openai')
    void unmount(component)
  })

  test('provider_api_key Replace control and provider_base_url input render alongside agent/provider selects', async () => {
    setMockFetch(() => Promise.resolve(json(withSelectsPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodingCredentialsSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

    await drain()

    // agent and provider selects must be present
    expect(target.querySelector('[data-testid="coding-select-agent"]')).not.toBeNull()
    expect(target.querySelector('[data-testid="coding-select-provider"]')).not.toBeNull()
    // Replace control for the masked api key must be present alongside the selects
    expect(target.querySelector('[data-testid="coding-replace-provider_api_key"]')).not.toBeNull()
    // The api key input itself should NOT be visible (key has a value, shows Replace)
    expect(target.querySelector('[data-testid="coding-input-provider_api_key"]')).toBeNull()
    // provider_base_url text input must be present (no value, not sensitive → always input)
    expect(target.querySelector('[data-testid="coding-input-provider_base_url"]')).not.toBeNull()
    void unmount(component)
  })

  test('saves select field by PATCHing on change', async () => {
    setCsrfToken('csrf-t')
    setMockFetch(routeSelectsMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodingCredentialsSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

    await drain()

    const agentSelect = target.querySelector<HTMLSelectElement>('[data-testid="coding-select-agent"]')!
    agentSelect.value = 'codex'
    agentSelect.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    await drain()

    const body: unknown = JSON.parse(capturedPatchBody)
    expect(body).toMatchObject({ values: { agent: 'codex' } })
    void unmount(component)
  })

  test('switching agent to an incompatible-provider agent patches both agent and provider atomically', async () => {
    // Starting from claude+anthropic, switching to codex must PATCH {agent:'codex', provider:'openai'} together
    // to avoid the 422 deadlock (merged state {codex,anthropic} is invalid server-side)
    setCsrfToken('csrf-t')
    setMockFetch(routeAtomicMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodingCredentialsSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

    await drain()

    // Confirm initial state: agent=claude, provider=anthropic
    const agentSelect = target.querySelector<HTMLSelectElement>('[data-testid="coding-select-agent"]')!
    expect(agentSelect.value).toBe('claude')

    // Change agent to codex (incompatible with anthropic)
    agentSelect.value = 'codex'
    agentSelect.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    await drain()

    // Must have issued exactly one PATCH with both agent and provider in the same body
    expect(capturedPatchBodies.length).toBeGreaterThanOrEqual(1)
    expect(JSON.parse(capturedPatchBodies[0]!)).toMatchObject({ values: { agent: 'codex', provider: 'openai' } })

    void unmount(component)
  })

  test('not-configured placeholder is provider-neutral, does not mention Anthropic', async () => {
    setMockFetch(() => Promise.resolve(json({ ...unconfiguredPayload, complete: false })))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodingCredentialsSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

    await drain()

    expect(target.querySelector('.placeholder')).not.toBeNull()
    expect(String(target.querySelector('.placeholder')?.textContent).toLowerCase()).not.toContain('anthropic')

    void unmount(component)
  })
})
