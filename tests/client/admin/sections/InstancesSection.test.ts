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
  referencingContextIds: ['ctx-1', 'ctx-2'],
  referencingContextCount: 2,
  unresolvedReason: null,
} as const

const stoppedPlatformInstance = {
  ...platformInstance,
  status: 'stopped',
} as const

const admin = {
  userId: 'admin-user',
  platformInstanceId: 'telegram-main',
  createdAt: '2026-05-24T00:02:00.000Z',
} as const

const applyResult = {
  applied: 1,
  started: ['telegram-main'],
  stopped: [],
  removed: [],
  recreated: [],
  unchanged: [],
  failed: [],
} as const

const failedApplyResult = {
  ...applyResult,
  started: [],
  failed: [{ id: 'telegram-main', action: 'stop', error: 'stop failed' }],
} as const

let nextApplyResult: unknown = applyResult

type RecordedCall = { readonly method: string; readonly url: string; readonly body: string | null }

const originalConfirm = window.confirm

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
  if (method === 'GET' && url === '/api/platform-provider-types')
    return jsonResponse([
      {
        type: 'telegram',
        displayName: 'Telegram',
        instanceConfigSchema: [{ key: 'token', label: 'Telegram Bot Token', required: true, sensitive: true }],
        contextConfigSchema: [],
        capabilities: ['commands'],
        traits: { observedGroupMessages: 'all', callbackDataMaxLength: 64 },
        source: 'builtin',
      },
      {
        type: 'mattermost',
        displayName: 'Mattermost',
        instanceConfigSchema: [
          { key: 'baseUrl', label: 'Mattermost URL', required: true, sensitive: false },
          { key: 'token', label: 'Mattermost Bot Token', required: true, sensitive: true },
        ],
        contextConfigSchema: [],
        capabilities: ['commands'],
        traits: { observedGroupMessages: 'all', maxMessageLength: 16383 },
        source: 'builtin',
      },
      {
        type: 'discord',
        displayName: 'Discord',
        instanceConfigSchema: [{ key: 'token', label: 'Discord Bot Token', required: true, sensitive: true }],
        contextConfigSchema: [],
        capabilities: ['commands'],
        traits: { observedGroupMessages: 'mentions_only', maxMessageLength: 2000 },
        source: 'builtin',
      },
    ])
  if (method === 'GET' && url === '/api/task-instances') return jsonResponse([taskInstance])
  if (method === 'GET' && url === '/api/admins') return jsonResponse([admin])
  if (method === 'GET' && url === '/api/task-provider-types')
    return jsonResponse([
      {
        type: 'kaneo',
        displayName: 'Kaneo',
        instanceConfigSchema: [{ key: 'baseUrl', label: 'Kaneo URL', required: true, sensitive: false }],
        contextConfigSchema: [],
        capabilities: ['comments.read'],
        traits: [],
        source: 'builtin',
      },
      {
        type: 'youtrack',
        displayName: 'YouTrack',
        instanceConfigSchema: [{ key: 'baseUrl', label: 'YouTrack URL', required: true, sensitive: false }],
        contextConfigSchema: [],
        capabilities: ['comments.read'],
        traits: [],
        source: 'builtin',
      },
      {
        type: 'linear',
        displayName: 'Linear',
        instanceConfigSchema: [
          { key: 'baseUrl', storageKey: 'tracker_url', label: 'Linear URL', required: true, sensitive: false },
          { key: 'apiKey', label: 'API Key', required: true, sensitive: true },
        ],
        contextConfigSchema: [],
        capabilities: ['comments.read'],
        traits: [],
        source: { plugin: 'linear-plugin' },
      },
    ])
  if (method === 'POST' && url === '/api/platform-instances') return jsonResponse(platformInstance)
  if (method === 'POST' && url === '/api/platform-instances/apply') return jsonResponse(nextApplyResult)
  if (method === 'PATCH' && url === '/api/platform-instances/telegram-main')
    return jsonResponse(stoppedPlatformInstance)
  if (method === 'DELETE' && url === '/api/platform-instances/telegram-main') return jsonResponse({ ok: true })
  if (method === 'POST' && url === '/api/task-instances') return jsonResponse(taskInstance)
  if (method === 'DELETE' && url === '/api/task-instances/kaneo-main') return jsonResponse({ ok: true })
  if (method === 'POST' && url === '/api/admins') return jsonResponse(admin)
  if (method === 'DELETE' && url === '/api/admins/admin-user/telegram-main') return jsonResponse({ ok: true })
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

const installFetchOverridingTaskInstances = (taskInstancesPayload: unknown): void => {
  const overrides: Record<string, Response> = {
    'GET /api/task-instances': jsonResponse(taskInstancesPayload),
  }
  setMockFetch((url, init) => {
    const method = methodFor(init)
    const key = `${method} ${url}`
    return Promise.resolve(overrides[key] ?? responseFor(method, url))
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

// happy-dom (v20) does not sync <option> :checked/selected state from select.value, so
// Svelte 5's change-event bind:value path never updates. Drive selection via the
// [selected]-attribute + form-reset path, which Svelte reads on the is_reset branch.
const selectTaskType = (target: HTMLElement, formTestId: string, value: string): void => {
  const el = select(target, 'task-type-input')
  const option = el.querySelector<HTMLOptionElement>(`option[value="${value}"]`)
  if (option === null) throw new Error(`option ${value} missing`)
  option.setAttribute('selected', '')
  const form = target.querySelector<HTMLFormElement>(`[data-testid="${formTestId}"]`)
  if (form === null) throw new Error(`${formTestId} missing`)
  form.dispatchEvent(new Event('reset', { bubbles: true }))
}

const selectPlatformType = (target: HTMLElement, value: string): void => {
  const el = select(target, 'platform-type-input')
  const option = el.querySelector<HTMLOptionElement>(`option[value="${value}"]`)
  if (option === null) throw new Error(`option ${value} missing`)
  option.setAttribute('selected', '')
  const form = target.querySelector<HTMLFormElement>('[data-testid="platform-create-form"]')
  if (form === null) throw new Error('platform-create-form missing')
  form.dispatchEvent(new Event('reset', { bubbles: true }))
}

const setConfirm = (value: boolean): void => {
  Object.defineProperty(window, 'confirm', {
    configurable: true,
    value: (): boolean => value,
  })
}

const recordConfirm = (value: boolean, messages: string[]): void => {
  Object.defineProperty(window, 'confirm', {
    configurable: true,
    value: (message: string): boolean => {
      messages.push(message)
      return value
    },
  })
}

afterEach(() => {
  restoreFetch()
  nextApplyResult = applyResult
  Object.defineProperty(window, 'confirm', {
    configurable: true,
    value: originalConfirm,
  })
})

describe('InstancesSection', () => {
  test('renders platform, task, and admin rows from the API', async () => {
    const calls: RecordedCall[] = []
    installFetch(calls)

    const { target, component } = render()
    await drain()

    expect(target.textContent).toContain('Platform Instances')
    expect(callNames(calls)).toContain('GET /api/platform-provider-types')
    expect(target.textContent).toContain('telegram-main')
    expect(target.textContent).toContain('****1234')
    expect(select(target, 'platform-type-input').textContent).toContain('Mattermost')
    selectPlatformType(target, 'mattermost')
    await drain()
    expect(input(target, 'platform-config-baseUrl')).toBeTruthy()
    expect(input(target, 'platform-config-token').type).toBe('password')
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
    enterValue(input(target, 'platform-config-token'), 'token')
    click(target, 'platform-create-button')
    await drain()

    expect(callNames(calls)).toContain('POST /api/platform-instances')
    expect(expectCall(calls[5], 5).body).toBe(
      JSON.stringify({ id: 'telegram-main', type: 'telegram', config: { token: 'token' } }),
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
    enterValue(input(target, 'platform-config-token'), 'token')
    click(target, 'platform-create-button')
    await drain()
    click(target, 'platform-apply-button')
    await drain()

    expect(callNames(calls)).toContain('POST /api/platform-instances/apply')
    expect(target.querySelector('[data-testid="platform-unapplied-indicator"]')).toBeNull()
    expect(target.textContent).toContain('Applied 1 platform change')

    void unmount(component)
  })

  test('keeps platform changes unapplied and shows failure when apply returns failures', async () => {
    const calls: RecordedCall[] = []
    nextApplyResult = failedApplyResult
    installFetch(calls)

    const { target, component } = render()
    await drain()

    enterValue(input(target, 'platform-id-input'), 'telegram-main')
    enterValue(input(target, 'platform-config-token'), 'token')
    click(target, 'platform-create-button')
    await drain()
    click(target, 'platform-apply-button')
    await drain()

    expect(callNames(calls)).toContain('POST /api/platform-instances/apply')
    expect(target.querySelector('[data-testid="platform-unapplied-indicator"]')).not.toBeNull()
    expect(target.textContent).toContain('Failed to apply 1 platform change')
    expect(target.textContent).toContain('telegram-main stop failed: stop failed')

    void unmount(component)
  })

  test('shows required platform config status instead of submitting', async () => {
    const calls: RecordedCall[] = []
    installFetch(calls)

    const { target, component } = render()
    await drain()

    enterValue(input(target, 'platform-id-input'), 'bad-platform')
    click(target, 'platform-create-button')
    await drain()

    expect(target.textContent).toContain('Telegram Bot Token is required')
    expect(callNames(calls)).toEqual([
      'GET /api/platform-instances',
      'GET /api/task-instances',
      'GET /api/admins',
      'GET /api/task-provider-types',
      'GET /api/platform-provider-types',
    ])

    void unmount(component)
  })

  test('creates super-admins by omitting blank platform instance IDs', async () => {
    const calls: RecordedCall[] = []
    installFetch(calls)

    const { target, component } = render()
    await drain()

    enterValue(input(target, 'admin-user-id-input'), 'super-admin')
    enterValue(input(target, 'admin-platform-id-input'), '   ')
    click(target, 'admin-create-button')
    await drain()

    expect(callNames(calls)).toContain('POST /api/admins')
    expect(expectCall(calls[5], 5).body).toBe(JSON.stringify({ userId: 'super-admin' }))

    void unmount(component)
  })

  test('updates platform status and confirms platform deletes', async () => {
    const calls: RecordedCall[] = []
    installFetch(calls)
    setConfirm(true)

    const { target, component } = render()
    await drain()

    click(target, 'platform-status-telegram-main')
    await drain()
    click(target, 'platform-delete-telegram-main')
    await drain()

    expect(callNames(calls)).toContain('PATCH /api/platform-instances/telegram-main')
    expect(expectCall(calls[5], 5).body).toBe(JSON.stringify({ status: 'stopped' }))
    expect(callNames(calls)).toContain('DELETE /api/platform-instances/telegram-main')

    void unmount(component)
  })

  test('does not delete platform instances when confirmation is cancelled', async () => {
    const calls: RecordedCall[] = []
    installFetch(calls)
    setConfirm(false)

    const { target, component } = render()
    await drain()

    click(target, 'platform-delete-telegram-main')
    await drain()

    expect(callNames(calls)).toEqual([
      'GET /api/platform-instances',
      'GET /api/task-instances',
      'GET /api/admins',
      'GET /api/task-provider-types',
      'GET /api/platform-provider-types',
    ])

    void unmount(component)
  })

  test('creates task instances and confirms task deletes', async () => {
    const calls: RecordedCall[] = []
    installFetch(calls)
    setConfirm(true)

    const { target, component } = render()
    await drain()

    enterValue(input(target, 'task-id-input'), 'kaneo-main')
    enterValue(input(target, 'task-config-baseUrl'), 'https://kaneo.invalid')
    click(target, 'task-create-button')
    await drain()
    click(target, 'task-delete-kaneo-main')
    await drain()

    expect(callNames(calls)).toContain('POST /api/task-instances')
    expect(expectCall(calls[5], 5).body).toBe(
      JSON.stringify({ id: 'kaneo-main', type: 'kaneo', config: { baseUrl: 'https://kaneo.invalid' } }),
    )
    expect(callNames(calls)).toContain('DELETE /api/task-instances/kaneo-main')

    void unmount(component)
  })

  test('creates task instances using instance config storage keys', async () => {
    const calls: RecordedCall[] = []
    installFetch(calls)

    const { target, component } = render()
    await drain()

    selectTaskType(target, 'task-create-form', 'linear')
    await drain()
    enterValue(input(target, 'task-id-input'), 'linear-main')
    enterValue(input(target, 'task-config-baseUrl'), 'https://linear.invalid')
    enterValue(input(target, 'task-config-apiKey'), 'lin-key')
    click(target, 'task-create-button')
    await drain()

    expect(callNames(calls)).toContain('POST /api/task-instances')
    expect(expectCall(calls[5], 5).body).toBe(
      JSON.stringify({
        id: 'linear-main',
        type: 'linear',
        config: { tracker_url: 'https://linear.invalid', apiKey: 'lin-key' },
      }),
    )
    expect(expectCall(calls[5], 5).body).not.toContain('baseUrl')

    void unmount(component)
  })

  test('does not delete task instances when confirmation is cancelled', async () => {
    const calls: RecordedCall[] = []
    const confirmMessages: string[] = []
    installFetch(calls)
    recordConfirm(false, confirmMessages)

    const { target, component } = render()
    await drain()

    click(target, 'task-delete-kaneo-main')
    await drain()

    expect(callNames(calls)).toEqual([
      'GET /api/platform-instances',
      'GET /api/task-instances',
      'GET /api/admins',
      'GET /api/task-provider-types',
      'GET /api/platform-provider-types',
    ])
    expect(confirmMessages).toEqual([
      'Delete task instance kaneo-main? This will delete 2 context settings: ctx-1, ctx-2.',
    ])

    void unmount(component)
  })

  test('creates admins and confirms admin removal', async () => {
    const calls: RecordedCall[] = []
    installFetch(calls)
    setConfirm(true)

    const { target, component } = render()
    await drain()

    enterValue(input(target, 'admin-user-id-input'), 'admin-user')
    enterValue(input(target, 'admin-platform-id-input'), 'telegram-main')
    click(target, 'admin-create-button')
    await drain()
    click(target, 'admin-remove-admin-user')
    await drain()

    expect(callNames(calls)).toContain('POST /api/admins')
    expect(expectCall(calls[5], 5).body).toBe(
      JSON.stringify({ userId: 'admin-user', platformInstanceId: 'telegram-main' }),
    )
    expect(callNames(calls)).toContain('DELETE /api/admins/admin-user/telegram-main')

    void unmount(component)
  })

  test('does not remove admins when confirmation is cancelled', async () => {
    const calls: RecordedCall[] = []
    installFetch(calls)
    setConfirm(false)

    const { target, component } = render()
    await drain()

    click(target, 'admin-remove-admin-user')
    await drain()

    expect(callNames(calls)).toEqual([
      'GET /api/platform-instances',
      'GET /api/task-instances',
      'GET /api/admins',
      'GET /api/task-provider-types',
      'GET /api/platform-provider-types',
    ])

    void unmount(component)
  })

  test('renders sensitive task config fields as password inputs', async () => {
    const calls: RecordedCall[] = []
    installFetch(calls)

    const { target, component } = render()
    await drain()

    selectTaskType(target, 'task-create-form', 'linear')
    await drain()

    expect(input(target, 'task-config-baseUrl').type).toBe('text')
    expect(input(target, 'task-config-apiKey').type).toBe('password')

    void unmount(component)
  })

  test('rebuilds task config inputs when the selected provider type changes', async () => {
    const calls: RecordedCall[] = []
    installFetch(calls)

    const { target, component } = render()
    await drain()

    expect(target.querySelector('[data-testid="task-config-baseUrl"]')).not.toBeNull()
    expect(target.querySelector('[data-testid="task-config-apiKey"]')).toBeNull()

    selectTaskType(target, 'task-create-form', 'linear')
    await drain()

    expect(target.querySelector('[data-testid="task-config-apiKey"]')).not.toBeNull()

    void unmount(component)
  })

  test('shows unresolved label when a task instance has no active provider plugin', async () => {
    const unresolvedReason =
      "Provider plugin for type 'no-plugin' is not active. Approve it in the settings web UI admin area (Plugins approval)."
    const unresolvedTaskInstance = {
      id: 'no-plugin-main',
      type: 'no-plugin',
      status: 'active',
      config: {},
      createdAt: '2026-05-29T00:00:00.000Z',
      referencingContextIds: [],
      referencingContextCount: 0,
      unresolvedReason,
    }

    installFetchOverridingTaskInstances([unresolvedTaskInstance])

    const { target, component } = render()
    await drain()

    const label = target.querySelector('[data-testid="task-instance-unresolved-no-plugin-main"]')
    expect(label).not.toBeNull()
    expect(label?.textContent).toContain('not active')

    void unmount(component)
  })
})
