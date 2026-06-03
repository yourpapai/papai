// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'
import { z } from 'zod'

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

const mcpPayloadWithHeaders = {
  contextId: 'user:1',
  endpoints: [
    {
      id: 'srv1',
      url: 'https://mcp.example/sse',
      label: 'Example',
      enabled: true,
      headers: { Authorization: '****1234' },
      toolFilter: { allow: ['tool_a', 'tool_b'], deny: ['tool_c'] },
    },
  ],
}

// Schema for parsing PUT body captured in tests
const PutBodySchema = z.object({
  endpoints: z.array(
    z.object({
      id: z.string(),
      url: z.string(),
      enabled: z.boolean(),
      label: z.string().optional(),
      headers: z.record(z.string(), z.string()).optional(),
      toolFilter: z.object({ allow: z.array(z.string()).optional(), deny: z.array(z.string()).optional() }).optional(),
    }),
  ),
})

let capturedPutMethod: string | undefined
let capturedPutBody: unknown

const capturePutMock = (url: string, init: RequestInit): Promise<Response> => {
  if (url.includes('/settings/api/mcp') && init.method !== undefined && init.method !== 'GET') {
    capturedPutMethod = init.method
    capturedPutBody = typeof init.body === 'string' ? JSON.parse(init.body) : init.body
    return Promise.resolve(json({ ok: true, contextId: 'user:1' }))
  }
  return Promise.resolve(json(mcpPayload))
}

const capturePutWithHeadersMock = (url: string, init: RequestInit): Promise<Response> => {
  if (url.includes('/settings/api/mcp') && init.method !== undefined && init.method !== 'GET') {
    capturedPutMethod = init.method
    capturedPutBody = typeof init.body === 'string' ? JSON.parse(init.body) : init.body
    return Promise.resolve(json({ ok: true, contextId: 'user:1' }))
  }
  return Promise.resolve(json(mcpPayloadWithHeaders))
}

const errorPutMock = (url: string, init: RequestInit): Promise<Response> => {
  if (url.includes('/settings/api/mcp') && init.method !== undefined && init.method !== 'GET') {
    return Promise.resolve(new Response('Internal Server Error', { status: 500 }))
  }
  return Promise.resolve(json(mcpPayload))
}

afterEach(() => {
  capturedPutMethod = undefined
  capturedPutBody = undefined
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

  // --- New tests for headers and toolFilter ---

  test('renders header rows for an endpoint that has headers', async () => {
    setMockFetch(() => Promise.resolve(json(mcpPayloadWithHeaders)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(McpSection, { target, props: { contextId: 'user:1' } })
    await drain()
    // Should render one header row for Authorization
    expect(target.querySelector('[data-testid="mcp-header-name-srv1-0"]')).not.toBeNull()
    expect(target.querySelector('[data-testid="mcp-header-value-srv1-0"]')).not.toBeNull()
    // The masked value should be prefilled
    const valueInput = target.querySelector<HTMLInputElement>('[data-testid="mcp-header-value-srv1-0"]')!
    expect(valueInput.value).toBe('****1234')
    void unmount(component)
  })

  test('Add header button adds an empty header row', async () => {
    setMockFetch(() => Promise.resolve(json(mcpPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(McpSection, { target, props: { contextId: 'user:1' } })
    await drain()
    // Initially no header rows
    expect(target.querySelector('[data-testid="mcp-header-name-srv1-0"]')).toBeNull()
    // Click "Add header"
    target.querySelector<HTMLButtonElement>('[data-testid="mcp-header-add-srv1"]')!.click()
    flushSync()
    // Now one header row exists
    expect(target.querySelector('[data-testid="mcp-header-name-srv1-0"]')).not.toBeNull()
    void unmount(component)
  })

  test('entering name+value and saving sends headers in putMcp payload', async () => {
    setCsrfToken('c')
    setMockFetch(capturePutMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(McpSection, { target, props: { contextId: 'user:1' } })
    await drain()

    // Add a header row
    target.querySelector<HTMLButtonElement>('[data-testid="mcp-header-add-srv1"]')!.click()
    flushSync()

    // Fill in name and value
    const nameInput = target.querySelector<HTMLInputElement>('[data-testid="mcp-header-name-srv1-0"]')!
    const valueInput = target.querySelector<HTMLInputElement>('[data-testid="mcp-header-value-srv1-0"]')!
    nameInput.value = 'Authorization'
    nameInput.dispatchEvent(new Event('input', { bubbles: true }))
    valueInput.value = 'Bearer secret'
    valueInput.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()

    // Save
    target.querySelector<HTMLButtonElement>('[data-testid="mcp-save"]')!.click()
    await drain()

    expect(capturedPutMethod).toBe('PUT')
    const body = PutBodySchema.parse(capturedPutBody)
    expect(body.endpoints[0]?.headers).toEqual({ Authorization: 'Bearer secret' })
    void unmount(component)
  })

  test('removing a header excludes it from the saved payload', async () => {
    setCsrfToken('c')
    setMockFetch(capturePutWithHeadersMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(McpSection, { target, props: { contextId: 'user:1' } })
    await drain()

    // Remove the existing Authorization header
    target.querySelector<HTMLButtonElement>('[data-testid="mcp-header-remove-srv1-0"]')!.click()
    flushSync()

    // Save
    target.querySelector<HTMLButtonElement>('[data-testid="mcp-save"]')!.click()
    await drain()

    expect(capturedPutMethod).toBe('PUT')
    const body = PutBodySchema.parse(capturedPutBody)
    // After removing the only header, headers should be omitted (undefined)
    expect(body.endpoints[0]?.headers).toBeUndefined()
    void unmount(component)
  })

  test('an unchanged masked header value is sent back as the masked string', async () => {
    setCsrfToken('c')
    setMockFetch(capturePutWithHeadersMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(McpSection, { target, props: { contextId: 'user:1' } })
    await drain()

    // Do not change anything, just save
    target.querySelector<HTMLButtonElement>('[data-testid="mcp-save"]')!.click()
    await drain()

    expect(capturedPutMethod).toBe('PUT')
    const body = PutBodySchema.parse(capturedPutBody)
    // The masked value ****1234 must be passed as-is so the server restores it
    expect(body.endpoints[0]?.headers?.['Authorization']).toBe('****1234')
    void unmount(component)
  })

  test('toolFilter allow/deny inputs prefill from endpoint data', async () => {
    setMockFetch(() => Promise.resolve(json(mcpPayloadWithHeaders)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(McpSection, { target, props: { contextId: 'user:1' } })
    await drain()

    const allowInput = target.querySelector<HTMLInputElement>('[data-testid="mcp-toolfilter-allow-srv1"]')!
    const denyInput = target.querySelector<HTMLInputElement>('[data-testid="mcp-toolfilter-deny-srv1"]')!
    expect(allowInput).not.toBeNull()
    expect(denyInput).not.toBeNull()
    // Should be prefilled with the allow/deny lists
    expect(allowInput.value).toContain('tool_a')
    expect(allowInput.value).toContain('tool_b')
    expect(denyInput.value).toContain('tool_c')
    void unmount(component)
  })

  test('editing toolFilter and saving sends parsed arrays in putMcp payload', async () => {
    setCsrfToken('c')
    setMockFetch(capturePutMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(McpSection, { target, props: { contextId: 'user:1' } })
    await drain()

    // Edit allow tools
    const allowInput = target.querySelector<HTMLInputElement>('[data-testid="mcp-toolfilter-allow-srv1"]')!
    allowInput.value = 'my_tool, another_tool'
    allowInput.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()

    // Edit deny tools
    const denyInput = target.querySelector<HTMLInputElement>('[data-testid="mcp-toolfilter-deny-srv1"]')!
    denyInput.value = 'bad_tool'
    denyInput.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()

    target.querySelector<HTMLButtonElement>('[data-testid="mcp-save"]')!.click()
    await drain()

    expect(capturedPutMethod).toBe('PUT')
    const body = PutBodySchema.parse(capturedPutBody)
    expect(body.endpoints[0]?.toolFilter?.allow).toEqual(['my_tool', 'another_tool'])
    expect(body.endpoints[0]?.toolFilter?.deny).toEqual(['bad_tool'])
    void unmount(component)
  })

  test('empty toolFilter fields omit toolFilter from the payload', async () => {
    setCsrfToken('c')
    setMockFetch(capturePutMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(McpSection, { target, props: { contextId: 'user:1' } })
    await drain()

    // Leave allow and deny empty (default state for endpoint with no toolFilter)
    target.querySelector<HTMLButtonElement>('[data-testid="mcp-save"]')!.click()
    await drain()

    expect(capturedPutMethod).toBe('PUT')
    const body = PutBodySchema.parse(capturedPutBody)
    expect(body.endpoints[0]?.toolFilter).toBeUndefined()
    void unmount(component)
  })

  test('renders endpoint label/url via Field+Input and actions via Btn', async () => {
    setMockFetch(() => Promise.resolve(json(mcpPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(McpSection, { target, props: { contextId: 'user:1' } })
    await drain()
    expect(target.querySelector('.settings-mcp__row .ui-field .ui-input')).not.toBeNull()
    expect(target.querySelector('[data-testid="mcp-add"]')?.classList.contains('ui-btn')).toBe(true)
    expect(target.querySelector('[data-testid="mcp-save"]')?.classList.contains('ui-btn')).toBe(true)
    expect(target.querySelector('[data-testid="mcp-remove-srv1"]')?.classList.contains('ui-btn')).toBe(true)
    void unmount(component)
  })
})
