// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import ProfileSection from '../../../../client/settings/sections/ProfileSection.svelte'
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
      key: 'mcp_endpoints',
      storageKey: 'mcp_endpoints',
      label: 'MCP Endpoints',
      required: false,
      sensitive: false,
      kind: 'preference',
      hasValue: false,
      value: '',
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

afterEach(() => {
  restoreFetch()
})

const errorResponse = (): Promise<Response> => Promise.resolve(new Response('Internal Server Error', { status: 500 }))

describe('ProfileSection', () => {
  test('renders only preference fields excluding mcp_endpoints', async () => {
    setMockFetch(() => Promise.resolve(json(configPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ProfileSection, { target, props: { contextId: 'user:1' } })
    await drain()
    expect(target.querySelector('#profile')).not.toBeNull()
    expect(target.querySelector('[data-testid="cfg-row-timezone"]')).not.toBeNull()
    expect(target.querySelector('[data-testid="cfg-row-mcp_endpoints"]')).toBeNull()
    expect(target.querySelector('[data-testid="cfg-row-kaneo_apikey"]')).toBeNull()
    void unmount(component)
  })

  test('shows an error message when the config fetch fails', async () => {
    setMockFetch(errorResponse)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ProfileSection, { target, props: { contextId: 'user:1' } })
    await drain()
    expect(target.querySelector('.status-error')).not.toBeNull()
    expect(target.querySelector('.ui-empty')).toBeNull()
    void unmount(component)
  })

  test('renders the refresh control as a kit Btn', () => {
    setMockFetch(() => Promise.resolve(json(configPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ProfileSection, { target, props: { contextId: 'ctx' } })
    expect(target.querySelector('.settings-section-header .ui-btn')).not.toBeNull()
    void unmount(component)
  })
})
