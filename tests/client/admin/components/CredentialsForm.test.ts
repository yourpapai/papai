// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import CredentialsForm from '../../../../client/admin/components/CredentialsForm.svelte'
import type { AdminLlmSnapshot } from '../../../../client/shared/api-types.js'
import { restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

const emptyKey = { value: null, updatedAt: null, updatedBy: null }

const emptySnapshot: AdminLlmSnapshot = {
  llm_apikey: emptyKey,
  llm_baseurl: emptyKey,
  main_model: emptyKey,
  small_model: emptyKey,
  embedding_model: emptyKey,
}

const populated: AdminLlmSnapshot = {
  llm_apikey: { value: '****1234', updatedAt: 1, updatedBy: 'admin' },
  llm_baseurl: { value: 'https://api.example.com', updatedAt: 2, updatedBy: 'env' },
  main_model: { value: 'gpt-9', updatedAt: 3, updatedBy: 'admin' },
  small_model: emptyKey,
  embedding_model: emptyKey,
}

const POST_RESPONSE = JSON.stringify({ ok: true, key: 'main_model', updatedAt: 99 })

const respondToPost = (url: string, init: RequestInit, recorded: { body: string | null }): Promise<Response> => {
  const matchesPost = url === '/admin/llm' && init.method === 'POST'
  const okBody = matchesPost ? POST_RESPONSE : 'not mocked'
  const okStatus = matchesPost ? 200 : 500
  recorded.body = matchesPost && typeof init.body === 'string' ? init.body : recorded.body
  return Promise.resolve(new Response(okBody, { status: okStatus, headers: { 'Content-Type': 'application/json' } }))
}

type Mounted = {
  target: HTMLElement
  component: ReturnType<typeof mount>
  refreshes: number
}

const render = (snapshot: AdminLlmSnapshot | null): Mounted => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')
  if (target === null) throw new Error('root missing')
  let refreshes = 0
  const component = mount(CredentialsForm, {
    target,
    props: {
      snapshot,
      onRefresh: () => {
        refreshes += 1
        return Promise.resolve()
      },
    },
  })
  return {
    target,
    component,
    get refreshes() {
      return refreshes
    },
  }
}

const requiredElement = (target: HTMLElement, selector: string): Element => {
  const element = target.querySelector(selector)
  if (element === null) throw new Error(`${selector} missing`)
  return element
}

const clickButton = (target: HTMLElement, selector: string): void => {
  const button = target.querySelector<HTMLButtonElement>(selector)
  if (button === null) throw new Error(`${selector} missing`)
  button.click()
}

beforeEach(() => {
  restoreFetch()
})

afterEach(() => {
  restoreFetch()
})

describe('CredentialsForm', () => {
  test('renders one row per system config key', () => {
    const { target, component } = render(populated)
    const rows = target.querySelectorAll('[data-testid="credentials-row"]')
    expect(rows).toHaveLength(5)
    void unmount(component)
  })

  test('shows masked llm_apikey value', () => {
    const { target, component } = render(populated)
    expect(target.textContent).toContain('****1234')
    void unmount(component)
  })

  test('renders sensitive key values in a masked-value element with a "hidden" hint', () => {
    const { target, component } = render(populated)
    const masked = requiredElement(target, '[data-testid="masked-value-llm_apikey"]')
    expect(masked.textContent).toContain('****1234')
    expect(target.textContent.toLowerCase()).toContain('hidden')
    void unmount(component)
  })

  test('does not render the masked-value element for non-sensitive keys', () => {
    const { target, component } = render(populated)
    expect(target.querySelector('[data-testid="masked-value-llm_baseurl"]')).toBeNull()
    expect(target.querySelector('[data-testid="masked-value-main_model"]')).toBeNull()
    void unmount(component)
  })

  test('shows "not set" for keys without a value', () => {
    const { target, component } = render(emptySnapshot)
    const text = target.textContent.toLowerCase()
    const occurrences = text.split('not set').length - 1
    expect(occurrences).toBeGreaterThanOrEqual(5)
    void unmount(component)
  })

  test('renders loading-state placeholder when snapshot is null', () => {
    const { target, component } = render(null)
    expect(target.textContent).toContain('Loading')
    void unmount(component)
  })

  test('clicking Edit reveals an input', () => {
    const { target, component } = render(populated)
    clickButton(target, '[data-testid="edit-main_model"]')
    flushSync()
    const input = target.querySelector<HTMLInputElement>('[data-testid="input-main_model"]')
    expect(input).not.toBeNull()
    void unmount(component)
  })

  test('submitting calls POST /admin/llm and triggers onRefresh on success', async () => {
    const recorded: { body: string | null } = { body: null }
    setMockFetch((url, init) => respondToPost(url, init, recorded))

    const m = render(populated)
    clickButton(m.target, '[data-testid="edit-main_model"]')
    flushSync()
    const input = m.target.querySelector<HTMLInputElement>('[data-testid="input-main_model"]')
    expect(input).not.toBeNull()
    const inputEl = input!
    inputEl.value = 'gpt-99'
    inputEl.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    clickButton(m.target, '[data-testid="submit-main_model"]')
    // Drain the async submit + onRefresh chain. Two microtask ticks cover
    // fetch().then().then() and the awaited onRefresh callback below it.
    for (let i = 0; i < 10; i++) await Promise.resolve()
    flushSync()

    expect(recorded.body).toBe(JSON.stringify({ key: 'main_model', value: 'gpt-99' }))
    expect(m.refreshes).toBeGreaterThanOrEqual(1)
    void unmount(m.component)
  })
})
