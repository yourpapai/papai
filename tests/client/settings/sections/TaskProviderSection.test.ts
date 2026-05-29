// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import { setCsrfToken } from '../../../../client/settings/fetchers.js'
import TaskProviderSection from '../../../../client/settings/sections/TaskProviderSection.svelte'
import { restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

const json = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const configPayload = {
  contextId: 'user:1',
  fields: [
    {
      key: 'timezone',
      storageKey: 'timezone',
      label: 'Timezone',
      required: true,
      sensitive: false,
      kind: 'preference',
      hasValue: true,
      value: 'UTC',
    },
    {
      key: 'kaneo_apikey',
      storageKey: 'kaneo_apikey',
      label: 'Kaneo API Key',
      required: false,
      sensitive: true,
      kind: 'provider-context',
      hasValue: false,
      value: '',
    },
  ],
}

const provisionPayload = {
  status: 'provisioned',
  contextId: 'user:1',
  email: 'a@b.c',
  password: 'p@ss',
  kaneoUrl: 'https://k',
  workspaceId: 'w1',
}

const routeProvisionMock = (url: string): Promise<Response> => {
  if (url.includes('/settings/api/provision/kaneo')) return Promise.resolve(json(provisionPayload))
  return Promise.resolve(json(configPayload))
}

afterEach(() => {
  restoreFetch()
  setCsrfToken('')
})

describe('TaskProviderSection', () => {
  test('renders provider-context fields only', async () => {
    setMockFetch(() => Promise.resolve(json(configPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(TaskProviderSection, { target, props: { contextId: 'user:1' } })
    await drain()
    expect(target.querySelector('[data-testid="cfg-row-kaneo_apikey"]')).not.toBeNull()
    expect(target.querySelector('[data-testid="cfg-row-timezone"]')).toBeNull()
    void unmount(component)
  })

  test('provision reveals one-time credentials', async () => {
    setCsrfToken('c')
    setMockFetch(routeProvisionMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(TaskProviderSection, { target, props: { contextId: 'user:1' } })
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="provision-kaneo"]')!.click()
    await drain()
    expect(target.textContent).toContain('a@b.c')
    expect(target.textContent).toContain('p@ss')
    expect(target.textContent).toContain('https://k')
    void unmount(component)
  })
})
