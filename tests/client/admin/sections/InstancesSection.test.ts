// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import InstancesSection from '../../../../client/admin/sections/InstancesSection.svelte'
import { restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

const platformInstance = {
  id: 'telegram-main',
  type: 'telegram',
  status: 'active',
  config: { TELEGRAM_BOT_TOKEN: '****1234' },
  createdAt: '2026-05-24T00:00:00.000Z',
} as const

const taskInstance = {
  id: 'kaneo-main',
  type: 'kaneo',
  status: 'active',
  config: { KANEO_INTERNAL_URL: 'http://kaneo:1337' },
  createdAt: '2026-05-24T00:01:00.000Z',
} as const

const admin = {
  userId: 'admin-user',
  platformInstanceId: 'telegram-main',
  createdAt: '2026-05-24T00:02:00.000Z',
} as const

type RecordedCall = { readonly method: string; readonly url: string; readonly body: string | null }

const drain = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
  flushSync()
}

const render = (): { readonly target: HTMLElement; readonly component: ReturnType<typeof mount> } => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')
  if (target === null) throw new Error('root missing')
  const component = mount(InstancesSection, { target })
  return { target, component }
}

const methodFor = (init: RequestInit): string => {
  if (init.method === undefined) return 'GET'
  return init.method
}

const jsonResponse = (payload: unknown, ...args: readonly [] | readonly [number]): Response => {
  const status = args.length === 0 ? 200 : args[0]
  return Response.json(payload, { status })
}

const callNames = (calls: readonly RecordedCall[]): readonly string[] =>
  calls.map((call) => `${call.method} ${call.url}`)

const responseFor = (method: string, url: string): Response => {
  if (method === 'GET' && url === '/api/platform-instances') return jsonResponse([platformInstance])
  if (method === 'GET' && url === '/api/task-instances') return jsonResponse([taskInstance])
  if (method === 'GET' && url === '/api/admins') return jsonResponse([admin])
  if (method === 'POST' && url === '/api/platform-instances') return jsonResponse(platformInstance)
  if (method === 'POST' && url === '/api/platform-instances/apply') return jsonResponse({ applied: 1 })
  return jsonResponse({ error: `not mocked: ${method} ${url}` }, 500)
}

const installFetch = (calls: RecordedCall[]): void => {
  setMockFetch((url, init) => {
    const method = methodFor(init)
    const body = typeof init.body === 'string' ? init.body : null
    calls.push({ method, url, body })
    return Promise.resolve(responseFor(method, url))
  })
}

const input = (target: HTMLElement, testId: string): HTMLInputElement => {
  const el = target.querySelector<HTMLInputElement>(`[data-testid="${testId}"]`)
  if (el === null) throw new Error(`${testId} missing`)
  return el
}

const select = (target: HTMLElement, testId: string): HTMLSelectElement => {
  const el = target.querySelector<HTMLSelectElement>(`[data-testid="${testId}"]`)
  if (el === null) throw new Error(`${testId} missing`)
  return el
}

const click = (target: HTMLElement, testId: string): void => {
  const button = target.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)
  if (button === null) throw new Error(`${testId} missing`)
  button.click()
}

const expectCall = (call: RecordedCall | undefined, index: number): RecordedCall => {
  expect(call, `missing call ${index}`).not.toBeUndefined()
  return call!
}

const enterValue = (el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string): void => {
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

afterEach(() => {
  restoreFetch()
})

describe('InstancesSection', () => {
  test('renders platform, task, and admin rows from the API', async () => {
    const calls: RecordedCall[] = []
    installFetch(calls)

    const { target, component } = render()
    await drain()

    expect(target.textContent).toContain('Platform Instances')
    expect(target.textContent).toContain('telegram-main')
    expect(target.textContent).toContain('****1234')
    expect(target.textContent).toContain('Task Instances')
    expect(target.textContent).toContain('kaneo-main')
    expect(target.textContent).toContain('Admins')
    expect(target.textContent).toContain('admin-user')

    void unmount(component)
  })

  test('creates a platform instance and shows unapplied changes', async () => {
    const calls: RecordedCall[] = []
    installFetch(calls)

    const { target, component } = render()
    await drain()

    enterValue(input(target, 'platform-id-input'), 'telegram-main')
    enterValue(select(target, 'platform-type-input'), 'telegram')
    enterValue(input(target, 'platform-config-input'), '{"TELEGRAM_BOT_TOKEN":"token"}')
    click(target, 'platform-create-button')
    await drain()

    expect(expectCall(calls[3], 3).body).toBe(
      JSON.stringify({ id: 'telegram-main', type: 'telegram', config: { TELEGRAM_BOT_TOKEN: 'token' } }),
    )
    expect(target.querySelector('[data-testid="platform-unapplied-indicator"]')).not.toBeNull()
    expect(target.textContent).toContain('Platform changes are unapplied')

    void unmount(component)
  })

  test('applies platform changes and clears unapplied indicator', async () => {
    const calls: RecordedCall[] = []
    installFetch(calls)

    const { target, component } = render()
    await drain()

    enterValue(input(target, 'platform-id-input'), 'telegram-main')
    enterValue(input(target, 'platform-config-input'), '{"TELEGRAM_BOT_TOKEN":"token"}')
    click(target, 'platform-create-button')
    await drain()
    click(target, 'platform-apply-button')
    await drain()

    expect(callNames(calls)).toContain('POST /api/platform-instances/apply')
    expect(target.querySelector('[data-testid="platform-unapplied-indicator"]')).toBeNull()
    expect(target.textContent).toContain('Applied 1 platform change')

    void unmount(component)
  })

  test('shows invalid config status instead of submitting', async () => {
    const calls: RecordedCall[] = []
    installFetch(calls)

    const { target, component } = render()
    await drain()

    enterValue(input(target, 'platform-id-input'), 'bad-platform')
    enterValue(input(target, 'platform-config-input'), '{"token":123}')
    click(target, 'platform-create-button')
    await drain()

    expect(target.textContent).toContain('Config must be a JSON object with string values')
    expect(callNames(calls)).toEqual(['GET /api/platform-instances', 'GET /api/task-instances', 'GET /api/admins'])

    void unmount(component)
  })
})
