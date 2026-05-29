// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import { setCsrfToken } from '../../../../client/settings/fetchers.js'
import McpSection from '../../../../client/settings/sections/McpSection.svelte'
import { restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

const json = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const mcpPayload = {
  contextId: 'user:1',
  endpoints: [{ id: 'srv1', url: 'https://mcp.example/sse', label: 'Example', enabled: true }],
}

let capturedPutMethod: string | undefined

const capturePutMock = (url: string, init: RequestInit): Promise<Response> => {
  if (url.includes('/settings/api/mcp') && init.method !== undefined && init.method !== 'GET') {
    capturedPutMethod = init.method
    return Promise.resolve(json({ ok: true, contextId: 'user:1' }))
  }
  return Promise.resolve(json(mcpPayload))
}

const errorPutMock = (url: string, init: RequestInit): Promise<Response> => {
  if (url.includes('/settings/api/mcp') && init.method !== undefined && init.method !== 'GET') {
    return Promise.resolve(new Response('Internal Server Error', { status: 500 }))
  }
  return Promise.resolve(json(mcpPayload))
}

afterEach(() => {
  capturedPutMethod = undefined
  restoreFetch()
  setCsrfToken('')
})

describe('McpSection', () => {
  test('renders existing endpoint rows', async () => {
    setMockFetch(() => Promise.resolve(json(mcpPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(McpSection, { target, props: { contextId: 'user:1' } })
    await drain()
    expect(target.querySelector('[data-testid="mcp-row-srv1"]')).not.toBeNull()
    void unmount(component)
  })

  test('save PUTs the endpoints array', async () => {
    setCsrfToken('c')
    setMockFetch(capturePutMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(McpSection, { target, props: { contextId: 'user:1' } })
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="mcp-save"]')!.click()
    await drain()
    expect(capturedPutMethod).toBe('PUT')
    void unmount(component)
  })

  test('a failed Save keeps the editor visible and shows an error', async () => {
    setCsrfToken('c')
    setMockFetch(errorPutMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(McpSection, { target, props: { contextId: 'user:1' } })
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="mcp-save"]')!.click()
    await drain()
    expect(target.querySelector('.status-error')).not.toBeNull()
    expect(target.querySelector('[data-testid="mcp-row-srv1"]')).not.toBeNull()
    void unmount(component)
  })

  test('Add endpoint adds a row', async () => {
    setMockFetch(() => Promise.resolve(json(mcpPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(McpSection, { target, props: { contextId: 'user:1' } })
    await drain()
    expect(target.querySelectorAll('[data-testid^="mcp-row-"]').length).toBe(1)
    target.querySelector<HTMLButtonElement>('[data-testid="mcp-add"]')!.click()
    flushSync()
    expect(target.querySelectorAll('[data-testid^="mcp-row-"]').length).toBe(2)
    void unmount(component)
  })
})
