// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import { setCsrfToken } from '../../../../../client/settings/fetchers.js'
import AdminSystemSection from '../../../../../client/settings/sections/admin/AdminSystemSection.svelte'
import { restoreFetch, setMockFetch } from '../../../../utils/test-helpers.js'

const json = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const extractStringBody = (init: RequestInit): string => (typeof init.body === 'string' ? init.body : '')

const systemPayload = {
  config: {
    llm_apikey: { value: '****1234', updatedAt: 1, updatedBy: 'admin' },
    main_model: { value: 'gpt-main', updatedAt: 2, updatedBy: 'admin' },
  },
}

let capturedSaveBody = ''
const captureSaveMock = (url: string, init: RequestInit): Promise<Response> => {
  if (url.includes('/admin/system') && (init.method ?? 'GET') === 'POST') {
    capturedSaveBody = extractStringBody(init)
    return Promise.resolve(json({ ok: true, key: 'main_model' }))
  }
  return Promise.resolve(json(systemPayload))
}

const failSaveMock = (url: string, init: RequestInit): Promise<Response> => {
  if (url.includes('/admin/system') && (init.method ?? 'GET') === 'POST') {
    return Promise.resolve(new Response('Internal Server Error', { status: 500 }))
  }
  return Promise.resolve(json(systemPayload))
}

afterEach(() => {
  capturedSaveBody = ''
  restoreFetch()
  setCsrfToken('')
})

describe('AdminSystemSection', () => {
  test('renders one row per config key', async () => {
    setMockFetch(() => Promise.resolve(json(systemPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminSystemSection, { target })
    await drain()
    expect(target.querySelector('#system')).not.toBeNull()
    expect(target.textContent).toContain('llm_apikey')
    expect(target.textContent).toContain('****1234')
    expect(target.textContent).toContain('gpt-main')
    void unmount(component)
  })

  test('llm_apikey input is type password', async () => {
    setMockFetch(() => Promise.resolve(json(systemPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminSystemSection, { target })
    await drain()
    const apikeyInput = target.querySelector<HTMLInputElement>('[data-testid="system-input-llm_apikey"]')!
    expect(apikeyInput.type).toBe('password')
    const modelInput = target.querySelector<HTMLInputElement>('[data-testid="system-input-main_model"]')!
    expect(modelInput.type).toBe('text')
    void unmount(component)
  })

  test('saving a key posts key + value', async () => {
    setCsrfToken('c')
    setMockFetch(captureSaveMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminSystemSection, { target })
    await drain()
    const input = target.querySelector<HTMLInputElement>('[data-testid="system-input-main_model"]')!
    input.value = 'gpt-next'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="system-save-main_model"]')!.click()
    await drain()
    expect(capturedSaveBody).toBe(JSON.stringify({ key: 'main_model', value: 'gpt-next' }))
    void unmount(component)
  })

  test('a failed save keeps the key list visible and shows an error', async () => {
    setCsrfToken('c')
    setMockFetch(failSaveMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminSystemSection, { target })
    await drain()
    const input = target.querySelector<HTMLInputElement>('[data-testid="system-input-main_model"]')!
    input.value = 'bad-value'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="system-save-main_model"]')!.click()
    await drain()
    expect(target.querySelector('.status-error')).not.toBeNull()
    expect(target.querySelector('[data-testid="system-row-main_model"]')).not.toBeNull()
    void unmount(component)
  })
})
