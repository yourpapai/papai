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
      label: 'Anthropic Base URL',
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
      label: 'Anthropic Base URL',
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
      options: ['anthropic', 'openai', 'openai-compatible'],
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
      label: 'Base URL',
      required: false,
      sensitive: false,
      hasValue: false,
      value: '',
    },
  ],
}

const withCodexPayload = {
  ...withSelectsPayload,
  fields: [{ ...withSelectsPayload.fields[0]!, value: 'codex' }, ...withSelectsPayload.fields.slice(1)],
}

const withOpencodePayload = {
  ...withSelectsPayload,
  fields: [{ ...withSelectsPayload.fields[0]!, value: 'opencode' }, ...withSelectsPayload.fields.slice(1)],
}

const withOpenAiCompatiblePayload = {
  ...withSelectsPayload,
  fields: [
    { ...withSelectsPayload.fields[0]!, value: 'opencode' },
    { ...withSelectsPayload.fields[1]!, value: 'openai-compatible' },
    ...withSelectsPayload.fields.slice(2),
  ],
}

const withComboboxPayload = {
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
      options: ['anthropic', 'openai', 'openai-compatible'],
    },
    {
      key: 'model',
      label: 'Model',
      required: false,
      sensitive: false,
      hasValue: false,
      value: '',
      control: 'combobox',
    },
    { key: 'provider_api_key', label: 'API key', required: true, sensitive: true, hasValue: true, value: '****' },
  ],
}

const baseUrlStoredPayload = {
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
      options: ['anthropic', 'openai', 'openai-compatible'],
    },
    {
      key: 'auth_method',
      label: 'Auth method',
      required: false,
      sensitive: false,
      hasValue: true,
      value: 'api-key',
      control: 'select',
      options: ['api-key', 'oauth-subscription'],
    },
    { key: 'provider_api_key', label: 'API key', required: true, sensitive: true, hasValue: true, value: '****' },
    {
      key: 'provider_base_url',
      label: 'Base URL',
      required: false,
      sensitive: false,
      hasValue: true,
      value: 'https://stored.example',
    },
  ],
}

const oauthOpenCodePayload = {
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
      value: 'opencode',
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
      options: ['anthropic', 'openai', 'openai-compatible'],
    },
    {
      key: 'auth_method',
      label: 'Auth method',
      required: false,
      sensitive: false,
      hasValue: true,
      value: 'oauth-subscription',
      control: 'select',
      options: ['api-key', 'oauth-subscription'],
    },
    { key: 'provider_api_key', label: 'API key', required: true, sensitive: true, hasValue: true, value: '****' },
    { key: 'provider_base_url', label: 'Base URL', required: false, sensitive: false, hasValue: false, value: '' },
  ],
}

const errorJson = (payload: { error: string; field?: string }): Response =>
  new Response(JSON.stringify(payload), { status: 422, headers: { 'Content-Type': 'application/json' } })

const makeFieldErrorMock =
  (errorPayload: { error: string; field?: string }, getPayload: unknown = withSelectsPayload) =>
  (_url: string, init?: RequestInit): Promise<Response> => {
    if (_url.includes('/settings/api/coding-credentials') && (init?.method ?? 'GET').toUpperCase() === 'PATCH')
      return Promise.resolve(errorJson(errorPayload))
    return Promise.resolve(json(getPayload))
  }

let capturedPatchBody = ''

const clearErrorMock = (_url: string, init?: RequestInit): Promise<Response> => {
  const method = (init?.method ?? 'GET').toUpperCase()
  if (_url.includes('/settings/api/coding-credentials') && method === 'PATCH') {
    const body = typeof init?.body === 'string' ? init.body : ''
    if (body.includes('"clear":true')) {
      return Promise.resolve(
        new Response(JSON.stringify({ error: 'clear failed' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }
    return Promise.resolve(json({ ok: true }))
  }
  return Promise.resolve(json(configuredPayload))
}

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

const routeBaseUrlStoredMock = (_url: string, init?: RequestInit): Promise<Response> => {
  if ((init?.method ?? 'GET').toUpperCase() === 'PATCH') {
    capturedPatchBody = typeof init?.body === 'string' ? init.body : ''
    return Promise.resolve(json({ ok: true }))
  }
  return Promise.resolve(json(baseUrlStoredPayload))
}

const routeOauthOpenCodeMock = (_url: string, init?: RequestInit): Promise<Response> => {
  if ((init?.method ?? 'GET').toUpperCase() === 'PATCH') {
    capturedPatchBody = typeof init?.body === 'string' ? init.body : ''
    return Promise.resolve(json({ ok: true }))
  }
  return Promise.resolve(json(oauthOpenCodePayload))
}

const failingSaveMock = (url: string, init?: RequestInit): Promise<Response> => {
  const method = (init?.method ?? 'GET').toUpperCase()
  if (url.includes('/settings/api/coding-credentials') && method === 'PATCH')
    return Promise.resolve(new Response('save failed', { status: 500 }))
  return Promise.resolve(json(withSelectsPayload))
}

interface ReloadFailState {
  getCount: number
}

const makeReloadFailsCodingMock =
  (state: ReloadFailState) =>
  (url: string, init?: RequestInit): Promise<Response> => {
    const method = (init?.method ?? 'GET').toUpperCase()
    if (url.includes('/settings/api/coding-credentials') && method === 'PATCH')
      return Promise.resolve(json({ ok: true }))
    state.getCount++
    if (state.getCount === 1) return Promise.resolve(json(withSelectsPayload))
    return Promise.resolve(new Response('reload failed', { status: 500 }))
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

  test('saves the section by PATCHing the whole record in one request', async () => {
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
    target.querySelector<HTMLButtonElement>('[data-testid="coding-credentials-save"]')!.click()
    await drain()

    expect(JSON.parse(capturedPatchBody)).toMatchObject({
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

  test('changing a select does not PATCH on its own (whole-record save model)', async () => {
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

    expect(capturedPatchBody).toBe('')
    void unmount(component)
  })

  test('switching agent resets the provider draft to a compatible option (no invalid merged state)', async () => {
    // Starting from claude+anthropic, switching to codex resets provider to a codex-compatible
    // value in the draft, so a subsequent whole-record save never sends {codex, anthropic}.
    setCsrfToken('csrf-t')
    setMockFetch(routeSelectsMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodingCredentialsSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

    await drain()

    const agentSelect = target.querySelector<HTMLSelectElement>('[data-testid="coding-select-agent"]')!
    expect(agentSelect.value).toBe('claude')
    agentSelect.value = 'codex'
    agentSelect.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    await drain()

    const providerSelect = target.querySelector<HTMLSelectElement>('[data-testid="coding-select-provider"]')!
    expect(providerSelect.value).toBe('openai')
    void unmount(component)
  })

  test('saves agent + provider + base URL together for openai-compatible (no 422 deadlock)', async () => {
    // Selecting openai-compatible and entering the base URL then saving once must send a
    // complete, valid record — previously selecting openai-compatible first 422'd because
    // the base URL was not yet present in the merged server state.
    setCsrfToken('csrf-t')
    setMockFetch(routeSelectsMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodingCredentialsSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

    await drain()

    const agentSelect = target.querySelector<HTMLSelectElement>('[data-testid="coding-select-agent"]')!
    agentSelect.value = 'opencode'
    agentSelect.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    const providerSelect = target.querySelector<HTMLSelectElement>('[data-testid="coding-select-provider"]')!
    providerSelect.value = 'openai-compatible'
    providerSelect.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    const baseUrl = target.querySelector<HTMLInputElement>('[data-testid="coding-input-provider_base_url"]')!
    baseUrl.value = 'https://llm.corp.com/v1'
    baseUrl.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()

    target.querySelector<HTMLButtonElement>('[data-testid="coding-credentials-save"]')!.click()
    await drain()

    const parsed: unknown = JSON.parse(capturedPatchBody)
    expect(parsed).toMatchObject({
      values: { agent: 'opencode', provider: 'openai-compatible', provider_base_url: 'https://llm.corp.com/v1' },
    })
    // The masked, untouched API key must not be re-sent.
    expect(parsed).not.toHaveProperty('values.provider_api_key')
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

  test('codex agent: provider options include openai-compatible', async () => {
    setMockFetch(() => Promise.resolve(json(withCodexPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodingCredentialsSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

    await drain()

    const providerSelect = target.querySelector<HTMLSelectElement>('[data-testid="coding-select-provider"]')
    expect(providerSelect).not.toBeNull()
    const options = Array.from(providerSelect!.options).map((o) => o.value)
    expect(options).toContain('openai-compatible')
    expect(options).toContain('openai')
    expect(options).not.toContain('anthropic')
    void unmount(component)
  })

  test('opencode agent: provider options include openai-compatible', async () => {
    setMockFetch(() => Promise.resolve(json(withOpencodePayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodingCredentialsSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

    await drain()

    const providerSelect = target.querySelector<HTMLSelectElement>('[data-testid="coding-select-provider"]')
    expect(providerSelect).not.toBeNull()
    const options = Array.from(providerSelect!.options).map((o) => o.value)
    expect(options).toContain('openai-compatible')
    expect(options).toContain('anthropic')
    expect(options).toContain('openai')
    void unmount(component)
  })

  test('claude agent: provider options do not include openai-compatible', async () => {
    setMockFetch(() => Promise.resolve(json(withSelectsPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodingCredentialsSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

    await drain()

    const providerSelect = target.querySelector<HTMLSelectElement>('[data-testid="coding-select-provider"]')
    expect(providerSelect).not.toBeNull()
    const options = Array.from(providerSelect!.options).map((o) => o.value)
    expect(options).not.toContain('openai-compatible')
    void unmount(component)
  })

  test('base-URL label shows as required when openai-compatible provider is selected', async () => {
    setMockFetch(() => Promise.resolve(json(withOpenAiCompatiblePayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodingCredentialsSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

    await drain()

    const baseUrlRow = target.querySelector<HTMLElement>('[data-testid="coding-row-provider_base_url"]')
    expect(baseUrlRow).not.toBeNull()
    const label = baseUrlRow!.querySelector('.settings-field__label')
    expect(label).not.toBeNull()
    // Should show a required indicator (asterisk) when openai-compatible is selected
    expect(label!.textContent).toContain('*')
    void unmount(component)
  })

  test('base-URL label does not show required asterisk for non-openai-compatible providers', async () => {
    setMockFetch(() => Promise.resolve(json(withSelectsPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodingCredentialsSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

    await drain()

    const baseUrlRow = target.querySelector<HTMLElement>('[data-testid="coding-row-provider_base_url"]')
    expect(baseUrlRow).not.toBeNull()
    const label = baseUrlRow!.querySelector('.settings-field__label')
    expect(label).not.toBeNull()
    // With anthropic selected, base URL is optional — no asterisk
    expect(label!.textContent).not.toContain('*')
    void unmount(component)
  })

  test('agent select only shows allowed agents when allowedAgents is restricted', async () => {
    const restrictedPayload = { ...withSelectsPayload, allowedAgents: ['claude'] }
    setMockFetch(() => Promise.resolve(json(restrictedPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodingCredentialsSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

    await drain()

    const agentSelect = target.querySelector<HTMLSelectElement>('[data-testid="coding-select-agent"]')
    expect(agentSelect).not.toBeNull()
    const options = Array.from(agentSelect!.options).map((o) => o.value)
    expect(options).toContain('claude')
    expect(options).not.toContain('codex')
    expect(options).not.toContain('opencode')
    void unmount(component)
  })

  const oauthPayload = {
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
        options: ['anthropic', 'openai', 'openai-compatible'],
      },
      {
        key: 'auth_method',
        label: 'Auth method',
        required: false,
        sensitive: false,
        hasValue: true,
        value: 'oauth-subscription',
        control: 'select',
        options: ['api-key', 'oauth-subscription'],
      },
      { key: 'provider_api_key', label: 'API key', required: true, sensitive: true, hasValue: true, value: '****' },
      { key: 'provider_base_url', label: 'Base URL', required: false, sensitive: false, hasValue: false, value: '' },
    ],
  }

  test('oauth-subscription relabels the secret to OAuth token and hides the base URL', async () => {
    setCsrfToken('t')
    setMockFetch(() => Promise.resolve(json(oauthPayload)))
    const target = document.createElement('div')
    document.body.appendChild(target)
    const cmp = mount(CodingCredentialsSection, { target, props: { contextId: 'ctx-1' } })
    await drain()
    expect(target.textContent).toContain('OAuth token')
    expect(target.querySelector('[data-testid="coding-row-provider_base_url"]')).toBeNull()
    void unmount(cmp)
    target.remove()
    restoreFetch()
  })

  test('collectValues clears provider_base_url when auth_method switches to oauth-subscription', async () => {
    setCsrfToken('csrf-t')
    setMockFetch(routeBaseUrlStoredMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodingCredentialsSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })
    await drain()
    const authSelect = target.querySelector<HTMLSelectElement>('[data-testid="coding-select-auth_method"]')!
    authSelect.value = 'oauth-subscription'
    authSelect.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="coding-credentials-save"]')!.click()
    await drain()
    expect(JSON.parse(capturedPatchBody)).toMatchObject({
      values: { auth_method: 'oauth-subscription', provider_base_url: '' },
    })
    void unmount(component)
  })

  test('collectValues resets auth_method to api-key when provider switches away from anthropic', async () => {
    setCsrfToken('csrf-t')
    setMockFetch(routeOauthOpenCodeMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodingCredentialsSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })
    await drain()
    const providerSelect = target.querySelector<HTMLSelectElement>('[data-testid="coding-select-provider"]')!
    providerSelect.value = 'openai'
    providerSelect.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="coding-credentials-save"]')!.click()
    await drain()
    expect(JSON.parse(capturedPatchBody)).toMatchObject({ values: { auth_method: 'api-key' } })
    void unmount(component)
  })

  test('the whole-record Save is disabled until a field changes', async () => {
    setMockFetch(() => Promise.resolve(json(withSelectsPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodingCredentialsSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })
    await drain()
    const save = target.querySelector<HTMLButtonElement>('[data-testid="coding-credentials-save"]')!
    expect(save.disabled).toBe(true)
    const providerSelect = target.querySelector<HTMLSelectElement>('[data-testid="coding-select-provider"]')!
    providerSelect.value = 'openai'
    providerSelect.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    expect(save.disabled).toBe(false)
    void unmount(component)
  })

  test('Save stays disabled on load even if a sensitive field reports hasValue:false with a non-empty value', async () => {
    // Regression guard: initialDrafts and formDirty must agree on the baseline an untouched
    // sensitive field is compared against. If they use different rules (e.g. one keys off
    // hasValue, the other off sensitive alone), a payload where hasValue is false but value is
    // non-empty makes the two disagree, and Save comes up enabled with no user edit.
    setMockFetch(() =>
      Promise.resolve(
        json({
          namespace: 'agent-provider',
          configured: true,
          complete: false,
          missing: [],
          fields: [
            {
              key: 'provider_api_key',
              label: 'Anthropic API Key',
              required: true,
              sensitive: true,
              hasValue: false,
              value: 'stale-leftover-value',
            },
          ],
        }),
      ),
    )
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodingCredentialsSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })
    await drain()
    const save = target.querySelector<HTMLButtonElement>('[data-testid="coding-credentials-save"]')!
    expect(save.disabled).toBe(true)
    void unmount(component)
  })

  test('a failed initial load renders ErrorState with a retry control', async () => {
    setMockFetch(() => Promise.resolve(new Response('boom', { status: 500 })))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodingCredentialsSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })
    await drain()
    expect(target.querySelector('[data-testid="error-retry"]')).not.toBeNull()
    void unmount(component)
  })

  test('a dropped connection on load shows the friendly unreachable-server message', async () => {
    setMockFetch(() => Promise.reject(new TypeError('Failed to fetch')))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodingCredentialsSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })
    await drain()
    const message = target.querySelector('.ui-error__message')
    expect(message?.textContent).toBe("Couldn't reach the server. Check your connection and try again.")
    void unmount(component)
  })

  test('a failed clear keeps the confirm dialog open with an inline error', async () => {
    setCsrfToken('c')
    setMockFetch(clearErrorMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodingCredentialsSection, { target, props: { contextId: 'ctx-1' } })
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="coding-credentials-clear"]')!.click()
    await drain()
    target.querySelector<HTMLButtonElement>('.modal .ui-btn--danger')!.click()
    await drain()
    expect(document.querySelector('.modal')).not.toBeNull()
    expect(document.querySelector('.modal .status-error')).not.toBeNull()
    void unmount(component)
  })

  test('a failed save shows an inline error with role="alert"', async () => {
    setCsrfToken('c')
    setMockFetch(failingSaveMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodingCredentialsSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })
    await drain()
    const providerSelect = target.querySelector<HTMLSelectElement>('[data-testid="coding-select-provider"]')!
    providerSelect.value = 'openai'
    providerSelect.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="coding-credentials-save"]')!.click()
    await drain()
    expect(target.querySelector('p.status-error[role="alert"]')).not.toBeNull()
    void unmount(component)
  })

  test('a save whose reload fails shows no success line', async () => {
    setCsrfToken('c')
    setMockFetch(makeReloadFailsCodingMock({ getCount: 0 }))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodingCredentialsSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })
    await drain()
    const providerSelect = target.querySelector<HTMLSelectElement>('[data-testid="coding-select-provider"]')!
    providerSelect.value = 'openai'
    providerSelect.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="coding-credentials-save"]')!.click()
    await drain()
    await drain()
    expect(target.querySelector('p[role="status"]')).toBeNull()
    void unmount(component)
  })

  test('the provider select has an accessible name via aria-labelledby', async () => {
    setMockFetch(() => Promise.resolve(json(withSelectsPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodingCredentialsSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })
    await drain()
    const select = target.querySelector<HTMLSelectElement>('[data-testid="coding-select-provider"]')!
    const labelledBy = select.getAttribute('aria-labelledby')
    expect(labelledBy).not.toBeNull()
    const labelEl = target.querySelector(`#${labelledBy}`)
    expect(labelEl).not.toBeNull()
    expect(labelEl!.textContent).toContain('Model provider')
    void unmount(component)
  })

  test('the model combobox has an accessible name via aria-labelledby', async () => {
    setMockFetch(() => Promise.resolve(json(withComboboxPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodingCredentialsSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })
    await drain()
    const combobox = target.querySelector<HTMLInputElement>('[data-testid="coding-combobox-model"]')!
    expect(combobox).not.toBeNull()
    const labelledBy = combobox.getAttribute('aria-labelledby')
    expect(labelledBy).not.toBeNull()
    const labelEl = target.querySelector(`#${labelledBy}`)
    expect(labelEl).not.toBeNull()
    expect(labelEl!.textContent).toContain('Model')
    void unmount(component)
  })

  test('shows a placeholder and no Save button when the field list is empty', async () => {
    setMockFetch(() =>
      Promise.resolve(
        json({ namespace: 'agent-provider', configured: false, complete: false, missing: [], fields: [] }),
      ),
    )
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodingCredentialsSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })

    await drain()

    const placeholder = target.querySelector('.placeholder')
    expect(placeholder).not.toBeNull()
    expect(String(placeholder?.textContent)).toContain('No provider fields available')
    expect(target.querySelector('[data-testid="coding-credentials-save"]')).toBeNull()
    void unmount(component)
  })

  test('a 422 naming a visible field renders inline under that field, not in the banner', async () => {
    setCsrfToken('csrf-t')
    setMockFetch(makeFieldErrorMock({ error: 'Key looks invalid.', field: 'provider_api_key' }))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodingCredentialsSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })
    await drain()

    target.querySelector<HTMLButtonElement>('[data-testid="coding-replace-provider_api_key"]')!.click()
    flushSync()
    const input = target.querySelector<HTMLInputElement>('[data-testid="coding-input-provider_api_key"]')!
    input.value = 'sk-ant-bad'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="coding-credentials-save"]')!.click()
    await drain()

    const row = target.querySelector<HTMLElement>('[data-testid="coding-row-provider_api_key"]')!
    const inlineError = row.querySelector('.settings-field__error')
    expect(inlineError).not.toBeNull()
    expect(inlineError!.textContent).toContain('Key looks invalid.')
    expect(target.querySelector('.status-error')).toBeNull()
    void unmount(component)
  })

  test('a 422 naming a hidden field falls back to the banner, with no inline error', async () => {
    setCsrfToken('csrf-t')
    // oauthOpenCodePayload has auth_method=oauth-subscription, which hides provider_base_url.
    setMockFetch(makeFieldErrorMock({ error: 'Base URL required.', field: 'provider_base_url' }, oauthOpenCodePayload))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodingCredentialsSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })
    await drain()

    expect(target.querySelector('[data-testid="coding-row-provider_base_url"]')).toBeNull()
    target.querySelector<HTMLButtonElement>('[data-testid="coding-replace-provider_api_key"]')!.click()
    flushSync()
    const input = target.querySelector<HTMLInputElement>('[data-testid="coding-input-provider_api_key"]')!
    input.value = 'sk-ant-oat01-new'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="coding-credentials-save"]')!.click()
    await drain()

    const banner = target.querySelector('.status-error')
    expect(banner).not.toBeNull()
    expect(banner!.textContent).toContain('Base URL required.')
    expect([...target.querySelectorAll('.settings-field__error')].every((n) => n.textContent === '')).toBe(true)
    void unmount(component)
  })

  test('a 422 naming an unknown field falls back to the banner, with no inline error', async () => {
    setCsrfToken('csrf-t')
    setMockFetch(makeFieldErrorMock({ error: 'Unknown field.', field: 'nonexistent_key' }))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodingCredentialsSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })
    await drain()

    target.querySelector<HTMLButtonElement>('[data-testid="coding-replace-provider_api_key"]')!.click()
    flushSync()
    const input = target.querySelector<HTMLInputElement>('[data-testid="coding-input-provider_api_key"]')!
    input.value = 'sk-ant-new'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="coding-credentials-save"]')!.click()
    await drain()

    const banner = target.querySelector('.status-error')
    expect(banner).not.toBeNull()
    expect(banner!.textContent).toContain('Unknown field.')
    expect([...target.querySelectorAll('.settings-field__error')].every((n) => n.textContent === '')).toBe(true)
    void unmount(component)
  })

  test('Auth method carries a hint explaining why it appeared', async () => {
    setMockFetch(() => Promise.resolve(json(baseUrlStoredPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodingCredentialsSection, { target, props: { contextId: 'user:1' } })
    await drain()

    const row = target.querySelector('[data-testid="coding-row-auth_method"]')
    expect(row?.textContent).toContain('Anthropic')
    void unmount(component)
  })

  test('Base URL carries a hint when the provider is openai-compatible', async () => {
    setMockFetch(() => Promise.resolve(json(withOpenAiCompatiblePayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodingCredentialsSection, { target, props: { contextId: 'user:1' } })
    await drain()

    const row = target.querySelector('[data-testid="coding-row-provider_base_url"]')
    expect(row?.textContent).toContain('OpenAI-compatible')
    void unmount(component)
  })

  test('a 422 with no field key renders in the banner', async () => {
    setCsrfToken('csrf-t')
    setMockFetch(makeFieldErrorMock({ error: 'Something went wrong.' }))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodingCredentialsSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })
    await drain()

    target.querySelector<HTMLButtonElement>('[data-testid="coding-replace-provider_api_key"]')!.click()
    flushSync()
    const input = target.querySelector<HTMLInputElement>('[data-testid="coding-input-provider_api_key"]')!
    input.value = 'sk-ant-new'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="coding-credentials-save"]')!.click()
    await drain()

    const banner = target.querySelector('.status-error')
    expect(banner).not.toBeNull()
    expect(banner!.textContent).toContain('Something went wrong.')
    expect([...target.querySelectorAll('.settings-field__error')].every((n) => n.textContent === '')).toBe(true)
    void unmount(component)
  })
})
