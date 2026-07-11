// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import { setCsrfToken } from '../../../../../client/settings/fetchers.js'
import AdminModuleSectionsSection from '../../../../../client/settings/sections/admin/AdminModuleSectionsSection.svelte'
import { restoreFetch, setMockFetch } from '../../../../utils/test-helpers.js'

const json = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const snapshotPayload = {
  sections: [
    {
      id: 'section-a',
      label: 'Section A',
      fields: [
        { key: 'api_key', label: 'API Key', value: '****cret', sensitive: true, required: true },
        { key: 'endpoint', label: 'Endpoint URL', value: null, sensitive: false, required: false },
      ],
    },
  ],
}

const emptyPayload = { sections: [] }

const readonlyDerivedPayload = {
  sections: [
    {
      id: 'section-a',
      label: 'Section A',
      fields: [
        { key: 'api_key', label: 'API Key', value: '****cret', sensitive: true, required: true },
        {
          key: 'derived_status',
          label: 'Connection status',
          value: 'connected',
          sensitive: false,
          required: false,
          control: 'readonly-derived',
        },
      ],
    },
  ],
}

let capturedPatchBody: string | undefined

const capturePatchMock = (url: string, init: RequestInit): Promise<Response> => {
  if (url.includes('/admin/module-sections') && init.method === 'PATCH') {
    capturedPatchBody = typeof init.body === 'string' ? init.body : undefined
    return Promise.resolve(json({ ok: true, id: 'section-a', key: 'api_key', updatedAt: 9999 }))
  }
  return Promise.resolve(json(snapshotPayload))
}

const patchErrorMock = (url: string, init: RequestInit): Promise<Response> => {
  if (url.includes('/admin/module-sections') && init.method === 'PATCH') {
    return Promise.resolve(
      new Response(JSON.stringify({ error: 'value must be a non-empty string' }), {
        status: 422,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  }
  return Promise.resolve(json(snapshotPayload))
}

afterEach(() => {
  capturedPatchBody = undefined
  restoreFetch()
  setCsrfToken('')
})

describe('AdminModuleSectionsSection', () => {
  test('renders section and field rows from snapshot', async () => {
    setMockFetch(() => Promise.resolve(json(snapshotPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminModuleSectionsSection, { target })
    await drain()
    expect(target.querySelector('#module-sections')).not.toBeNull()
    expect(target.textContent).toContain('Section A')
    expect(target.textContent).toContain('API Key')
    expect(target.textContent).toContain('****cret')
    expect(target.textContent).toContain('Endpoint URL')
    void unmount(component)
  })

  test('shows unset placeholder for null field values', async () => {
    setMockFetch(() => Promise.resolve(json(snapshotPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminModuleSectionsSection, { target })
    await drain()
    const endpointRow = target.querySelector('[data-testid="module-section-field-section-a-endpoint"]')
    expect(endpointRow).not.toBeNull()
    expect(endpointRow!.textContent).toContain('unset')
    void unmount(component)
  })

  test('renders masked value via Secret for non-null sensitive field', async () => {
    setMockFetch(() => Promise.resolve(json(snapshotPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminModuleSectionsSection, { target })
    await drain()
    expect(target.querySelector('.ui-secret')).not.toBeNull()
    void unmount(component)
  })

  test('saving a field PATCHes the correct payload', async () => {
    setCsrfToken('c')
    setMockFetch(capturePatchMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminModuleSectionsSection, { target })
    await drain()

    const input = target.querySelector<HTMLInputElement>('[data-testid="module-section-input-section-a-api_key"]')!
    expect(input).not.toBeNull()
    input.value = 'new-secret-value'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()

    target.querySelector<HTMLButtonElement>('[data-testid="module-section-save-section-a-api_key"]')!.click()
    await drain()

    expect(capturedPatchBody).toBe(JSON.stringify({ id: 'section-a', key: 'api_key', value: 'new-secret-value' }))
    void unmount(component)
  })

  test('sensitive field renders input type password, others type text', async () => {
    setMockFetch(() => Promise.resolve(json(snapshotPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminModuleSectionsSection, { target })
    await drain()
    const sensitiveInput = target.querySelector<HTMLInputElement>(
      '[data-testid="module-section-input-section-a-api_key"]',
    )!
    expect(sensitiveInput.type).toBe('password')
    const plainInput = target.querySelector<HTMLInputElement>(
      '[data-testid="module-section-input-section-a-endpoint"]',
    )!
    expect(plainInput.type).toBe('text')
    void unmount(component)
  })

  test('empty sections list renders EmptyState and keeps the section shell', async () => {
    setMockFetch(() => Promise.resolve(json(emptyPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminModuleSectionsSection, { target })
    await drain()
    expect(target.querySelector('#module-sections')).not.toBeNull()
    expect(target.textContent).toContain('No module settings')
    void unmount(component)
  })

  test('422 error from PATCH shows error message and keeps the rows visible', async () => {
    setCsrfToken('c')
    setMockFetch(patchErrorMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminModuleSectionsSection, { target })
    await drain()

    const input = target.querySelector<HTMLInputElement>('[data-testid="module-section-input-section-a-api_key"]')!
    input.value = 'bad-value'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="module-section-save-section-a-api_key"]')!.click()
    await drain()

    expect(target.querySelector('.status-error[role="alert"]')).not.toBeNull()
    expect(target.querySelector('[data-testid="module-section-field-section-a-api_key"]')).not.toBeNull()
    void unmount(component)
  })

  test('readonly-derived field renders its value with no save/clear editor, legacy field keeps its editor', async () => {
    setMockFetch(() => Promise.resolve(json(readonlyDerivedPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminModuleSectionsSection, { target })
    await drain()

    const derivedRow = target.querySelector('[data-testid="module-section-field-section-a-derived_status"]')
    expect(derivedRow).not.toBeNull()
    expect(derivedRow!.textContent).toContain('connected')
    expect(target.querySelector('[data-testid="module-section-input-section-a-derived_status"]')).toBeNull()
    expect(target.querySelector('[data-testid="module-section-save-section-a-derived_status"]')).toBeNull()
    expect(target.querySelector('[data-testid="module-section-clear-section-a-derived_status"]')).toBeNull()

    // Legacy (non-readonly-derived) field in the same payload still renders its editor unchanged.
    expect(target.querySelector('[data-testid="module-section-input-section-a-api_key"]')).not.toBeNull()
    expect(target.querySelector('[data-testid="module-section-save-section-a-api_key"]')).not.toBeNull()
    void unmount(component)
  })
})
