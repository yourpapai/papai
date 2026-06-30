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

let capturedPatchBody = ''

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
})
