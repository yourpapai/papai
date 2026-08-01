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
  new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

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
      label: 'Host type',
      required: true,
      sensitive: false,
      hasValue: true,
      value: 'github',
      control: 'select' as const,
      options: ['github', 'github-enterprise', 'gitlab', 'gitlab-self-hosted'],
    },
    {
      key: 'instance_url',
      label: 'Instance URL',
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
      label: 'Host type',
      required: true,
      sensitive: false,
      hasValue: true,
      value: 'gitlab-self-hosted',
      control: 'select' as const,
      options: ['github', 'github-enterprise', 'gitlab', 'gitlab-self-hosted'],
    },
    {
      key: 'instance_url',
      label: 'Instance URL',
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
      label: 'Host type',
      required: true,
      sensitive: false,
      hasValue: false,
      value: '',
      control: 'select' as const,
      options: ['github', 'github-enterprise', 'gitlab', 'gitlab-self-hosted'],
    },
    {
      key: 'instance_url',
      label: 'Instance URL',
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

// Configured but incomplete, with a known kind: the header can name the host.
const typedForgeIncomplete = {
  namespace: 'forge',
  configured: true,
  complete: false,
  missing: ['forge_token'],
  fields: [
    {
      key: 'kind',
      label: 'Host type',
      required: true,
      sensitive: false,
      hasValue: true,
      value: 'github',
      control: 'select' as const,
      options: ['github', 'github-enterprise', 'gitlab', 'gitlab-self-hosted'],
    },
    { key: 'instance_url', label: 'Instance URL', required: false, sensitive: false, hasValue: false, value: '' },
    { key: 'forge_token', label: 'Access token', required: true, sensitive: true, hasValue: false, value: '' },
  ],
}

// Configured but the kind itself is missing: there is no host to name, so no sub line.
const typedForgeIncompleteNoKind = {
  ...typedForgeIncomplete,
  missing: ['kind', 'forge_token'],
  fields: [
    { ...typedForgeIncomplete.fields[0]!, hasValue: false, value: '' },
    typedForgeIncomplete.fields[1]!,
    typedForgeIncomplete.fields[2]!,
  ],
}

const typedForgeUnreadable = {
  ...typedForgeIncompleteNoKind,
  unreadable: true,
  error: 'stored credentials are unreadable',
}

const errorJson = (payload: { error: string; field?: string }): Response =>
  new Response(JSON.stringify(payload), { status: 422, headers: { 'Content-Type': 'application/json' } })

const makeFieldErrorMock =
  (errorPayload: { error: string; field?: string }) =>
  (_url: string, init?: RequestInit): Promise<Response> => {
    if (_url.includes('/settings/api/coding-credentials') && (init?.method ?? 'GET').toUpperCase() === 'PATCH')
      return Promise.resolve(errorJson(errorPayload))
    return Promise.resolve(json(typedForgePayloadSaas))
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

interface ReloadFailState {
  getCount: number
}

const makeReloadFailsCodeHostMock =
  (state: ReloadFailState) =>
  (url: string, init?: RequestInit): Promise<Response> => {
    const method = (init?.method ?? 'GET').toUpperCase()
    if (url.includes('/settings/api/coding-credentials') && method === 'PATCH')
      return Promise.resolve(json({ ok: true }))
    state.getCount++
    if (state.getCount === 1) return Promise.resolve(json(typedForgePayloadSelfHosted))
    return Promise.resolve(new Response('reload failed', { status: 500 }))
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
    const component = mount(CodeHostSection, {
      target,
      props: { contextId: 'pi:telegram:ctx:u1' },
    })

    await drain()

    expect(target.querySelector('[data-testid="coding-input-forge_token"]')).not.toBeNull()
    void unmount(component)
  })

  test('renders the section with id code-host and code-host-refresh testid', async () => {
    setMockFetch(() => Promise.resolve(json(unconfiguredPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodeHostSection, {
      target,
      props: { contextId: 'pi:telegram:ctx:u1' },
    })

    await drain()

    expect(target.querySelector('#code-host')).not.toBeNull()
    expect(target.querySelector('[data-testid="code-host-refresh"]')).not.toBeNull()
    void unmount(component)
  })

  test('shows Replace button and no input for configured sensitive field', async () => {
    setMockFetch(() => Promise.resolve(json(configuredPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodeHostSection, {
      target,
      props: { contextId: 'pi:telegram:ctx:u1' },
    })

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
    const component = mount(CodeHostSection, {
      target,
      props: { contextId: 'pi:telegram:ctx:u1' },
    })

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
    const component = mount(CodeHostSection, {
      target,
      props: { contextId: 'pi:telegram:ctx:u1' },
    })

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
    const component = mount(CodeHostSection, {
      target,
      props: { contextId: 'pi:telegram:ctx:u1' },
    })

    await drain()

    // instance_url field should not be visible when kind = 'github'
    expect(target.querySelector('[data-testid="coding-input-instance_url"]')).toBeNull()
    void unmount(component)
  })

  test('shows instance_url field for self-hosted kind (gitlab-self-hosted)', async () => {
    setMockFetch(() => Promise.resolve(json(typedForgePayloadSelfHosted)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodeHostSection, {
      target,
      props: { contextId: 'pi:telegram:ctx:u1' },
    })

    await drain()

    // instance_url field should be visible when kind = 'gitlab-self-hosted'
    expect(target.querySelector('[data-testid="coding-input-instance_url"]')).not.toBeNull()
    void unmount(component)
  })

  test('renders token field masked (no plain text) when token is configured', async () => {
    setMockFetch(() => Promise.resolve(json(typedForgePayloadSaas)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodeHostSection, {
      target,
      props: { contextId: 'pi:telegram:ctx:u1' },
    })

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
    const component = mount(CodeHostSection, {
      target,
      props: { contextId: 'pi:telegram:ctx:u1' },
    })

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
    const component = mount(CodeHostSection, {
      target,
      props: { contextId: 'pi:telegram:ctx:u1' },
    })

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
      values: {
        kind: 'gitlab-self-hosted',
        instance_url: 'https://gl.corp.com',
        forge_token: 'glpat-1',
      },
    })
    void unmount(component)
  })

  test('saving a configured forge omits the untouched masked token', async () => {
    setCsrfToken('csrf-t')
    setMockFetch(routeCodeHostMockSelfHosted)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodeHostSection, {
      target,
      props: { contextId: 'pi:telegram:ctx:u1' },
    })

    await drain()

    // Make a real change (edit the instance URL) so the whole-record Save is enabled;
    // the untouched masked token must still be omitted from the PATCH.
    const instance = target.querySelector<HTMLInputElement>('[data-testid="coding-input-instance_url"]')!
    instance.value = 'https://gitlab.corp.com/edited'
    instance.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()

    target.querySelector<HTMLButtonElement>('[data-testid="code-host-save"]')!.click()
    await drain()

    const parsed: unknown = JSON.parse(capturedPatchBody)
    expect(parsed).toMatchObject({
      values: {
        kind: 'gitlab-self-hosted',
        instance_url: 'https://gitlab.corp.com/edited',
      },
    })
    expect(parsed).not.toHaveProperty('values.forge_token')
    void unmount(component)
  })

  test('a failed clear keeps the confirm dialog open with an inline error', async () => {
    setCsrfToken('c')
    setMockFetch(clearErrorMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodeHostSection, {
      target,
      props: { contextId: 'ctx-1' },
    })
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="code-host-clear"]')!.click()
    await drain()
    target.querySelector<HTMLButtonElement>('.modal .ui-btn--danger')!.click()
    await drain()
    expect(document.querySelector('.modal')).not.toBeNull()
    expect(document.querySelector('.modal .status-error')).not.toBeNull()
    void unmount(component)
  })

  test('the whole-record Save is disabled until a field changes (configured host)', async () => {
    setMockFetch(() => Promise.resolve(json(typedForgePayloadSelfHosted)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodeHostSection, {
      target,
      props: { contextId: 'pi:telegram:ctx:u1' },
    })
    await drain()
    const save = target.querySelector<HTMLButtonElement>('[data-testid="code-host-save"]')!
    expect(save.disabled).toBe(true)
    const instance = target.querySelector<HTMLInputElement>('[data-testid="coding-input-instance_url"]')!
    instance.value = 'https://gitlab.corp.com/x'
    instance.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    expect(save.disabled).toBe(false)
    void unmount(component)
  })

  test('a failed initial load renders ErrorState with a retry control', async () => {
    setMockFetch(() => Promise.resolve(new Response('boom', { status: 500 })))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodeHostSection, {
      target,
      props: { contextId: 'pi:telegram:ctx:u1' },
    })
    await drain()
    expect(target.querySelector('[data-testid="error-retry"]')).not.toBeNull()
    void unmount(component)
  })

  test('a save success line is announced via role="status"', async () => {
    setCsrfToken('csrf-t')
    setMockFetch(routeCodeHostMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodeHostSection, {
      target,
      props: { contextId: 'pi:telegram:ctx:u1' },
    })
    await drain()
    const input = target.querySelector<HTMLInputElement>('[data-testid="coding-input-forge_token"]')!
    input.value = 'ghp_secret'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="code-host-save"]')!.click()
    // two drains: saveAll() awaits patchCodingCredentials then load()
    await drain()
    await drain()
    expect(target.querySelector('p[role="status"]')).not.toBeNull()
    void unmount(component)
  })

  test('rows carry no redundant Field sub-label after the shell migration', async () => {
    setMockFetch(() => Promise.resolve(json(typedForgePayloadSelfHosted)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodeHostSection, {
      target,
      props: { contextId: 'pi:telegram:ctx:u1' },
    })
    await drain()
    expect(target.querySelector('.ui-field__label')).toBeNull()
    void unmount(component)
  })

  test('a save whose reload fails shows no success line', async () => {
    setCsrfToken('csrf-t')
    const state = { getCount: 0 }
    setMockFetch(makeReloadFailsCodeHostMock(state))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodeHostSection, {
      target,
      props: { contextId: 'pi:telegram:ctx:u1' },
    })
    await drain()
    const instance = target.querySelector<HTMLInputElement>('[data-testid="coding-input-instance_url"]')!
    instance.value = 'https://gitlab.corp.com/edited'
    instance.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="code-host-save"]')!.click()
    await drain()
    await drain()
    expect(target.querySelector('p[role="status"]')).toBeNull()
    expect(target.querySelector('p.status-error[role="alert"]')).not.toBeNull()
    void unmount(component)
  })

  test('the kind select has an accessible name via aria-labelledby', async () => {
    setMockFetch(() => Promise.resolve(json(typedForgePayloadSelfHosted)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodeHostSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })
    await drain()
    const select = target.querySelector<HTMLSelectElement>('[data-testid="coding-select-kind"]')!
    const labelledBy = select.getAttribute('aria-labelledby')
    expect(labelledBy).not.toBeNull()
    const labelEl = target.querySelector(`#${labelledBy}`)
    expect(labelEl).not.toBeNull()
    expect(labelEl!.textContent).toContain('Host type')
    void unmount(component)
  })

  test('a 422 naming a visible field renders inline under that field, not in the banner', async () => {
    setCsrfToken('csrf-t')
    setMockFetch(makeFieldErrorMock({ error: 'Token looks invalid.', field: 'forge_token' }))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodeHostSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })
    await drain()

    target.querySelector<HTMLButtonElement>('[data-testid="coding-replace-forge_token"]')!.click()
    flushSync()
    const input = target.querySelector<HTMLInputElement>('[data-testid="coding-input-forge_token"]')!
    input.value = 'ghp_bad'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="code-host-save"]')!.click()
    await drain()

    const row = target.querySelector<HTMLElement>('[data-testid="coding-row-forge_token"]')!
    const inlineError = row.querySelector('.settings-field__error')
    expect(inlineError).not.toBeNull()
    expect(inlineError!.textContent).toContain('Token looks invalid.')
    expect(target.querySelector('.status-error')).toBeNull()
    void unmount(component)
  })

  test('a 422 naming a hidden field falls back to the banner, with no inline error', async () => {
    setCsrfToken('csrf-t')
    // typedForgePayloadSaas has kind=github, which hides instance_url.
    setMockFetch(makeFieldErrorMock({ error: 'Instance URL required.', field: 'instance_url' }))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodeHostSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })
    await drain()

    target.querySelector<HTMLButtonElement>('[data-testid="coding-replace-forge_token"]')!.click()
    flushSync()
    const input = target.querySelector<HTMLInputElement>('[data-testid="coding-input-forge_token"]')!
    input.value = 'ghp_new'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="code-host-save"]')!.click()
    await drain()

    const banner = target.querySelector('.status-error')
    expect(banner).not.toBeNull()
    expect(banner!.textContent).toContain('Instance URL required.')
    expect(target.querySelector('.settings-field__error')).toBeNull()
    void unmount(component)
  })

  test('a 422 naming an unknown field falls back to the banner, with no inline error', async () => {
    setCsrfToken('csrf-t')
    setMockFetch(makeFieldErrorMock({ error: 'Unknown field.', field: 'nonexistent_key' }))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodeHostSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })
    await drain()

    target.querySelector<HTMLButtonElement>('[data-testid="coding-replace-forge_token"]')!.click()
    flushSync()
    const input = target.querySelector<HTMLInputElement>('[data-testid="coding-input-forge_token"]')!
    input.value = 'ghp_new'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="code-host-save"]')!.click()
    await drain()

    const banner = target.querySelector('.status-error')
    expect(banner).not.toBeNull()
    expect(banner!.textContent).toContain('Unknown field.')
    expect(target.querySelector('.settings-field__error')).toBeNull()
    void unmount(component)
  })

  test('a 422 with no field key renders in the banner', async () => {
    setCsrfToken('csrf-t')
    setMockFetch(makeFieldErrorMock({ error: 'Something went wrong.' }))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodeHostSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })
    await drain()

    target.querySelector<HTMLButtonElement>('[data-testid="coding-replace-forge_token"]')!.click()
    flushSync()
    const input = target.querySelector<HTMLInputElement>('[data-testid="coding-input-forge_token"]')!
    input.value = 'ghp_new'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="code-host-save"]')!.click()
    await drain()

    const banner = target.querySelector('.status-error')
    expect(banner).not.toBeNull()
    expect(banner!.textContent).toContain('Something went wrong.')
    expect(target.querySelector('.settings-field__error')).toBeNull()
    void unmount(component)
  })

  const mountWith = async (payload: unknown): Promise<HTMLElement> => {
    setMockFetch(() => Promise.resolve(json(payload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    mount(CodeHostSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })
    await drain()
    return target
  }

  const pillText = (target: HTMLElement): string | null =>
    target.querySelector('.ui-page-header__action .ui-pill')?.textContent?.trim() ?? null

  const subText = (target: HTMLElement): string | null =>
    target.querySelector('.ui-page-header__sub')?.textContent?.trim() ?? null

  test('renders no status pill while the first load is still in flight', async () => {
    setMockFetch(() => new Promise<Response>(() => {}))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    mount(CodeHostSection, { target, props: { contextId: 'pi:telegram:ctx:u1' } })
    await drain()

    expect(pillText(target)).toBeNull()
    expect(subText(target)).toBeNull()
  })

  test('shows "not connected" and no sub when the forge vault is unconfigured', async () => {
    const target = await mountWith(typedForgeUnconfigured)

    expect(pillText(target)).toBe('not connected')
    expect(subText(target)).toBeNull()
  })

  test('shows "pending" and no sub when the stored kind itself is missing', async () => {
    const target = await mountWith(typedForgeIncompleteNoKind)

    expect(pillText(target)).toBe('pending')
    expect(subText(target)).toBeNull()
  })

  test('shows "pending" and names the host when only the token is missing', async () => {
    const target = await mountWith(typedForgeIncomplete)

    expect(pillText(target)).toBe('pending')
    expect(subText(target)).toBe('GitHub · needs an access token')
  })

  test('shows "connected" and the SaaS host when the record is complete', async () => {
    const target = await mountWith(typedForgePayloadSaas)

    expect(pillText(target)).toBe('connected')
    expect(subText(target)).toBe('GitHub · github.com')
  })

  test('shows "connected" and the derived host for a self-hosted instance URL', async () => {
    const target = await mountWith(typedForgePayloadSelfHosted)

    expect(pillText(target)).toBe('connected')
    expect(subText(target)).toBe('GitLab (self-hosted) · gitlab.corp.com')
  })

  test('shows "error" and no sub when the stored record is unreadable', async () => {
    const target = await mountWith(typedForgeUnreadable)

    expect(pillText(target)).toBe('error')
    expect(subText(target)).toBeNull()
  })

  test('shows the first-setup helper when the record is incomplete', async () => {
    const target = await mountWith(typedForgeIncomplete)

    const hint = target.querySelector('[data-testid="code-host-setup-hint"]')
    expect(hint).not.toBeNull()
    expect(hint!.textContent).toContain('push branches and open pull requests as you')
    expect(hint!.textContent).toContain('read and write repository contents and pull requests')
  })

  test('hides the first-setup helper once the record is complete', async () => {
    const target = await mountWith(typedForgePayloadSaas)

    expect(target.querySelector('[data-testid="code-host-setup-hint"]')).toBeNull()
  })

  test('gives the access token a scope-describing placeholder', async () => {
    const target = await mountWith(typedForgeIncomplete)

    const input = target.querySelector<HTMLInputElement>('[data-testid="coding-input-forge_token"]')!
    expect(input.placeholder).toBe('token with repo read/write access')
  })

  test('marks Instance URL required and hints it while a self-hosted kind is selected', async () => {
    const target = await mountWith(typedForgePayloadSelfHosted)

    const row = target.querySelector('[data-testid="coding-row-instance_url"]')!
    expect(row.querySelector('.settings-field__req')).not.toBeNull()
    expect(row.querySelector('.settings-field__hint')?.textContent).toContain(
      'Needed because you chose a self-hosted code host.',
    )
    expect(row.querySelector('.settings-field__hint')?.textContent).toContain(
      'Your operator must also allow this host for coding sessions.',
    )
    const input = target.querySelector<HTMLInputElement>('[data-testid="coding-input-instance_url"]')!
    expect(input.placeholder).toBe('https://gitlab.example.com')
  })

  test('drops the Instance URL marker and hint when the kind switches back to SaaS', async () => {
    const target = await mountWith(typedForgePayloadSelfHosted)

    const select = target.querySelector<HTMLSelectElement>('[data-testid="coding-select-kind"]')!
    select.value = 'github'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    await drain()

    // The whole row goes away with the field, taking the marker and hint with it.
    expect(target.querySelector('[data-testid="coding-row-instance_url"]')).toBeNull()
  })

  test('reveals a required, hinted Instance URL when a self-hosted kind is chosen', async () => {
    const target = await mountWith(typedForgePayloadSaas)

    expect(target.querySelector('[data-testid="coding-row-instance_url"]')).toBeNull()

    const select = target.querySelector<HTMLSelectElement>('[data-testid="coding-select-kind"]')!
    select.value = 'gitlab-self-hosted'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    await drain()

    const row = target.querySelector('[data-testid="coding-row-instance_url"]')!
    expect(row.querySelector('.settings-field__req')).not.toBeNull()
    expect(row.querySelector('.settings-field__hint')?.textContent).toContain('self-hosted code host')
  })

  test('clears a stored instance URL when saving under a SaaS kind', async () => {
    setCsrfToken('csrf-t')
    setMockFetch(routeCodeHostMockSelfHosted)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodeHostSection, {
      target,
      props: { contextId: 'pi:telegram:ctx:u1' },
    })

    await drain()

    // Stored record is gitlab-self-hosted + https://gitlab.corp.com. Switch to a SaaS kind,
    // which hides the instance_url field, and save.
    const select = target.querySelector<HTMLSelectElement>('[data-testid="coding-select-kind"]')!
    select.value = 'github'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    await drain()

    target.querySelector<HTMLButtonElement>('[data-testid="code-host-save"]')!.click()
    await drain()

    // Explicitly '' — not merely absent. An absent key leaves the stored URL in place;
    // toMatchObject fails if the key is missing rather than treating it as a don't-care.
    expect(JSON.parse(capturedPatchBody)).toMatchObject({
      values: { kind: 'github', instance_url: '' },
    })
    void unmount(component)
  })

  test('keeps the instance URL in the payload when the kind still needs it', async () => {
    setCsrfToken('csrf-t')
    setMockFetch(routeCodeHostMockSelfHosted)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(CodeHostSection, {
      target,
      props: { contextId: 'pi:telegram:ctx:u1' },
    })

    await drain()

    const instance = target.querySelector<HTMLInputElement>('[data-testid="coding-input-instance_url"]')!
    instance.value = 'https://gitlab.corp.com/edited'
    instance.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()

    target.querySelector<HTMLButtonElement>('[data-testid="code-host-save"]')!.click()
    await drain()

    expect(JSON.parse(capturedPatchBody)).toMatchObject({
      values: { instance_url: 'https://gitlab.corp.com/edited' },
    })
    void unmount(component)
  })

  test('shows a recoverable message when the response carries no fields', async () => {
    const target = await mountWith({
      namespace: 'forge',
      configured: false,
      complete: false,
      missing: ['kind', 'forge_token'],
      fields: [],
    })

    const empty = target.querySelector('[data-testid="code-host-no-fields"]')
    expect(empty).not.toBeNull()
    expect(empty!.textContent).toContain('No code host fields available — try Refresh.')
    // The setup helper is suppressed: it would contradict "no fields available".
    expect(target.querySelector('[data-testid="code-host-setup-hint"]')).toBeNull()
    expect(target.querySelector('[data-testid="code-host-save"]')).toBeNull()
  })

  test('renders the Clear trigger with the danger variant', async () => {
    const target = await mountWith(typedForgePayloadSaas)

    const clear = target.querySelector('[data-testid="code-host-clear"]')!
    expect(clear.classList.contains('ui-btn--danger')).toBe(true)
  })
})
