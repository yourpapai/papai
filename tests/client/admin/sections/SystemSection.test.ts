// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import SystemSection from '../../../../client/admin/sections/SystemSection.svelte'
import { restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

const emptyKey = { value: null, updatedAt: null, updatedBy: null }

const llmSnapshot = {
  llm_apikey: { value: '****1234', updatedAt: 1, updatedBy: 'admin' },
  llm_baseurl: { value: 'https://llm.example.test/v1', updatedAt: 2, updatedBy: 'admin' },
  main_model: { value: 'gpt-main', updatedAt: 3, updatedBy: 'admin' },
  small_model: emptyKey,
  embedding_model: emptyKey,
}

const systemSummary = {
  chatProvider: 'telegram',
  taskProvider: 'kaneo',
  debugServer: true,
  adminUserSet: true,
}

const render = (): {
  readonly component: ReturnType<typeof mount>
  readonly target: HTMLElement
} => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')
  if (target === null) throw new Error('root missing')
  const component = mount(SystemSection, { target })
  return { component, target }
}

const requestMethod = (init: RequestInit): string => {
  if (init.method === undefined) return 'GET'
  return init.method
}

const responseFor = (responses: ReadonlyMap<string, Response>, call: string): Response => {
  const response = responses.get(call)
  if (response === undefined) return new Response('not mocked', { status: 500 })
  return response
}

const responseFrom = (responses: ReadonlyMap<string, () => Response>, call: string): Response => {
  const response = responses.get(call)
  if (response === undefined) return new Response('not mocked', { status: 500 })
  return response()
}

const clickButton = (target: HTMLElement, selector: string): void => {
  const button = target.querySelector<HTMLButtonElement>(selector)
  if (button === null) throw new Error(`${selector} missing`)
  button.click()
}

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const jsonResponse = (payload: unknown): Response => new Response(JSON.stringify(payload), { status: 200 })

const installReadFetch = (): void => {
  const responses = new Map<string, Response>([
    ['GET /admin/system', jsonResponse(systemSummary)],
    ['GET /admin/llm', jsonResponse(llmSnapshot)],
  ])
  setMockFetch((url, init) => Promise.resolve(responseFor(responses, `${requestMethod(init)} ${url}`)))
}

const installEditFetch = (recorded: { body: string | null; calls: string[] }): void => {
  const responses = new Map<string, () => Response>([
    ['GET /admin/system', (): Response => jsonResponse(systemSummary)],
    ['GET /admin/llm', (): Response => jsonResponse(llmSnapshot)],
    ['POST /admin/llm', (): Response => jsonResponse({ ok: true, key: 'main_model', updatedAt: 99 })],
  ])
  setMockFetch((url, init) => {
    const call = `${requestMethod(init)} ${url}`
    recorded.calls = [...recorded.calls, call]
    recorded.body = call === 'POST /admin/llm' && typeof init.body === 'string' ? init.body : recorded.body
    return Promise.resolve(responseFrom(responses, call))
  })
}

afterEach(() => {
  restoreFetch()
})

describe('SystemSection', () => {
  test('renders system summary and LLM credentials form', async () => {
    installReadFetch()

    const { component, target } = render()
    await drain()

    expect(target.textContent).toContain('System')
    expect(target.textContent).toContain('telegram')
    expect(target.textContent).toContain('kaneo')
    expect(target.textContent).toContain('Debug server')
    expect(target.textContent).toContain('Enabled')
    expect(target.querySelectorAll('[data-testid="credentials-row"]')).toHaveLength(5)
    expect(target.textContent).toContain('****1234')

    void unmount(component)
  })

  test('saves an edited LLM setting and refreshes the credentials snapshot', async () => {
    const recorded: { body: string | null; calls: string[] } = { body: null, calls: [] }
    installEditFetch(recorded)

    const { component, target } = render()
    await drain()

    clickButton(target, '[data-testid="edit-main_model"]')
    flushSync()
    const input = target.querySelector<HTMLInputElement>('[data-testid="input-main_model"]')
    expect(input).not.toBeNull()
    const inputEl = input!
    inputEl.value = 'gpt-updated'
    inputEl.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    clickButton(target, '[data-testid="submit-main_model"]')
    await drain()

    expect(recorded.body).toBe(JSON.stringify({ key: 'main_model', value: 'gpt-updated' }))
    expect(recorded.calls.filter((call) => call === 'GET /admin/llm').length).toBeGreaterThanOrEqual(2)

    void unmount(component)
  })
})
