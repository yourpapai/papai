// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import ConfigFieldRow from '../../../../client/settings/components/ConfigFieldRow.svelte'
import { setCsrfToken } from '../../../../client/settings/fetchers.js'
import { restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

const json = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })

const parseBody = (body: BodyInit | null | undefined): unknown => (typeof body === 'string' ? JSON.parse(body) : null)
const bodyString = (init: RequestInit): string => JSON.stringify(parseBody(init.body))

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const render = (props: Record<string, unknown>): { component: ReturnType<typeof mount>; target: HTMLElement } => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  return { component: mount(ConfigFieldRow, { target, props }), target }
}

afterEach(() => {
  restoreFetch()
  setCsrfToken('')
})

describe('ConfigFieldRow', () => {
  test('saving a non-sensitive field PATCHes the new value', async () => {
    setCsrfToken('c')
    let body = ''
    setMockFetch((_url, init) => {
      body = bodyString(init)
      return Promise.resolve(json({ ok: true, contextId: 'user:1' }))
    })
    let saved = false
    const { component, target } = render({
      contextId: 'user:1',
      field: {
        key: 'timezone',
        storageKey: 'timezone',
        label: 'Timezone',
        required: true,
        sensitive: false,
        kind: 'preference',
        hasValue: true,
        value: 'UTC',
      },
      onSaved: () => {
        saved = true
      },
    })
    flushSync()
    const input = target.querySelector<HTMLInputElement>('[data-testid="cfg-input-timezone"]')!
    input.value = 'Europe/Berlin'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="cfg-save-timezone"]')!.click()
    await drain()
    expect(body).toBe(JSON.stringify({ key: 'timezone', value: 'Europe/Berlin', contextId: 'user:1' }))
    expect(saved).toBe(true)
    void unmount(component)
  })

  test('a sensitive field with a value shows the masked placeholder and a replace control', () => {
    setMockFetch(() => Promise.resolve(json({})))
    const { component, target } = render({
      contextId: 'user:1',
      field: {
        key: 'kaneo_apikey',
        storageKey: 'kaneo_apikey',
        label: 'Kaneo API Key',
        required: false,
        sensitive: true,
        kind: 'provider-context',
        hasValue: true,
        value: '****1234',
      },
      onSaved: () => undefined,
    })
    flushSync()
    expect(target.textContent).toContain('••••1234')
    expect(target.querySelector('[data-testid="cfg-replace-kaneo_apikey"]')).not.toBeNull()
    void unmount(component)
  })

  test('replacing a sensitive field PATCHes the new value', async () => {
    setCsrfToken('c')
    let body = ''
    setMockFetch((_url, init) => {
      body = bodyString(init)
      return Promise.resolve(json({ ok: true, contextId: 'user:1' }))
    })
    let saved = false
    const { component, target } = render({
      contextId: 'user:1',
      field: {
        key: 'kaneo_apikey',
        storageKey: 'kaneo_apikey',
        label: 'Kaneo API Key',
        required: false,
        sensitive: true,
        kind: 'provider-context',
        hasValue: true,
        value: '****1234',
      },
      onSaved: () => {
        saved = true
      },
    })
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="cfg-replace-kaneo_apikey"]')!.click()
    flushSync()
    const input = target.querySelector<HTMLInputElement>('[data-testid="cfg-input-kaneo_apikey"]')!
    input.value = 'my-secret-value'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="cfg-save-kaneo_apikey"]')!.click()
    await drain()
    expect(body).toBe(JSON.stringify({ key: 'kaneo_apikey', value: 'my-secret-value', contextId: 'user:1' }))
    expect(saved).toBe(true)
    void unmount(component)
  })

  test('non-sensitive field input is wrapped in .ui-input and save button has ui-btn class', () => {
    setMockFetch(() => Promise.resolve(json({})))
    const { component, target } = render({
      contextId: 'user:1',
      field: {
        key: 'k',
        storageKey: 'k',
        label: 'Key',
        required: false,
        sensitive: false,
        kind: 'preference',
        hasValue: false,
        value: '',
      },
      onSaved: () => undefined,
    })
    flushSync()
    const inputEl = target.querySelector<HTMLInputElement>('[data-testid="cfg-input-k"]')!
    expect(inputEl).not.toBeNull()
    expect(inputEl.closest('.ui-input')).not.toBeNull()
    const saveBtn = target.querySelector<HTMLButtonElement>('[data-testid="cfg-save-k"]')!
    expect(saveBtn).not.toBeNull()
    expect(saveBtn.classList.contains('ui-btn')).toBe(true)
    void unmount(component)
  })

  test('sensitive field with value renders .ui-secret and replace button has ui-btn class', () => {
    setMockFetch(() => Promise.resolve(json({})))
    const { component, target } = render({
      contextId: 'user:1',
      field: {
        key: 'k',
        storageKey: 'k',
        label: 'Key',
        required: false,
        sensitive: true,
        kind: 'preference',
        hasValue: true,
        value: '****abcd',
      },
      onSaved: () => undefined,
    })
    flushSync()
    expect(target.querySelector('.ui-secret')).not.toBeNull()
    const replaceBtn = target.querySelector<HTMLButtonElement>('[data-testid="cfg-replace-k"]')!
    expect(replaceBtn).not.toBeNull()
    expect(replaceBtn.classList.contains('ui-btn')).toBe(true)
    void unmount(component)
  })

  test('sensitive field with no stored value lets you enter and save the initial value', async () => {
    setCsrfToken('c')
    let body = ''
    setMockFetch((_url, init) => {
      body = bodyString(init)
      return Promise.resolve(json({ ok: true, contextId: 'user:1' }))
    })
    let saved = false
    const { component, target } = render({
      contextId: 'user:1',
      field: {
        key: 'token',
        storageKey: 'plugin:task-provider-youtrack:provider:token',
        label: 'YouTrack Permanent Token',
        required: true,
        sensitive: true,
        kind: 'provider-context',
        hasValue: false,
        value: '',
      },
      onSaved: () => {
        saved = true
      },
    })
    flushSync()
    // An unset secret has nothing to mask/replace, so the editor must be open directly.
    const input = target.querySelector<HTMLInputElement>('[data-testid="cfg-input-token"]')!
    expect(input).not.toBeNull()
    expect(target.querySelector('[data-testid="cfg-replace-token"]')).toBeNull()
    input.value = 'perm-token-xyz'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="cfg-save-token"]')!.click()
    await drain()
    expect(body).toBe(JSON.stringify({ key: 'token', value: 'perm-token-xyz', contextId: 'user:1' }))
    expect(saved).toBe(true)
    void unmount(component)
  })

  test('renders bullet-masked secret and a secondary Replace button', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const field = {
      key: 'token',
      storageKey: 'plugin:task-provider-youtrack:provider:token',
      label: 'Token',
      value: '****WvfQ',
      sensitive: true,
      hasValue: true,
      required: false,
      kind: 'provider-context',
    }
    const c = mount(ConfigFieldRow, { target, props: { contextId: 'user:1', field, onSaved: () => {} } })
    flushSync()
    expect(target.textContent).toContain('••••WvfQ')
    expect(target.querySelector('[data-testid="cfg-replace-token"]')!.className).toContain('ui-btn--secondary')
    void unmount(c)
  })

  test('cancel resets the sensitive replace editor', () => {
    setMockFetch(() => Promise.resolve(json({})))
    const { component, target } = render({
      contextId: 'user:1',
      field: {
        key: 'kaneo_apikey',
        storageKey: 'kaneo_apikey',
        label: 'Kaneo API Key',
        required: false,
        sensitive: true,
        kind: 'provider-context',
        hasValue: true,
        value: '****1234',
      },
      onSaved: () => undefined,
    })
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="cfg-replace-kaneo_apikey"]')!.click()
    flushSync()
    const input = target.querySelector<HTMLInputElement>('[data-testid="cfg-input-kaneo_apikey"]')!
    input.value = 'partial-typing'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="cfg-cancel-kaneo_apikey"]')!.click()
    flushSync()
    expect(target.textContent).toContain('••••1234')
    expect(target.querySelector('[data-testid="cfg-input-kaneo_apikey"]')).toBeNull()
    void unmount(component)
  })
})
