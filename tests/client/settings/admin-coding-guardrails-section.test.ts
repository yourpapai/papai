// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import { setCsrfToken } from '../../../client/settings/fetchers.js'
import AdminCodingGuardrailsSection from '../../../client/settings/sections/admin/AdminCodingGuardrailsSection.svelte'
import { restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

const json = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const defaultPayload = {
  guardrails: { allowedAgents: ['claude', 'codex', 'opencode'], whoMayUse: 'members', forceSharedKey: false },
  sharedKeySet: false,
}

const keySetPayload = {
  guardrails: { allowedAgents: ['claude'], whoMayUse: ['user-1'], forceSharedKey: true },
  sharedKeySet: true,
}

let lastPostBody: string | null = null

const captureMock = (_url: string, init?: RequestInit): Promise<Response> => {
  if (init?.method === 'POST') lastPostBody = typeof init.body === 'string' ? init.body : null
  return Promise.resolve(json(defaultPayload))
}

afterEach(() => {
  lastPostBody = null
  restoreFetch()
  setCsrfToken('')
})

describe('AdminCodingGuardrailsSection', () => {
  test('renders the section with id coding-guardrails', async () => {
    setMockFetch(() => Promise.resolve(json(defaultPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminCodingGuardrailsSection, { target })
    await drain()
    expect(target.querySelector('#coding-guardrails')).not.toBeNull()
    void unmount(component)
  })

  test('renders agent checkboxes for all three agents', async () => {
    setMockFetch(() => Promise.resolve(json(defaultPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminCodingGuardrailsSection, { target })
    await drain()
    expect(target.querySelector('[data-testid="guardrails-agent-claude"]')).not.toBeNull()
    expect(target.querySelector('[data-testid="guardrails-agent-codex"]')).not.toBeNull()
    expect(target.querySelector('[data-testid="guardrails-agent-opencode"]')).not.toBeNull()
    void unmount(component)
  })

  test('saving policy POSTs kind:policy to admin endpoint', async () => {
    setCsrfToken('c')
    setMockFetch(captureMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminCodingGuardrailsSection, { target })
    await drain()
    lastPostBody = null
    target.querySelector<HTMLButtonElement>('[data-testid="guardrails-save-policy"]')!.click()
    await drain()
    expect(lastPostBody).not.toBeNull()
    expect(JSON.stringify(JSON.parse(lastPostBody!))).toContain('"kind":"policy"')
    void unmount(component)
  })

  test('shows key-set UI when sharedKeySet is true', async () => {
    setMockFetch(() => Promise.resolve(json(keySetPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminCodingGuardrailsSection, { target })
    await drain()
    expect(target.querySelector('[data-testid="guardrails-key-set"]')).not.toBeNull()
    expect(target.querySelector('[data-testid="guardrails-replace-key"]')).not.toBeNull()
    void unmount(component)
  })

  test('shows key input form when sharedKeySet is false', async () => {
    setMockFetch(() => Promise.resolve(json(defaultPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminCodingGuardrailsSection, { target })
    await drain()
    expect(target.querySelector('[data-testid="guardrails-key-input"]')).not.toBeNull()
    expect(target.querySelector('[data-testid="guardrails-key-set"]')).toBeNull()
    void unmount(component)
  })
})
