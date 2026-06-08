// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'
import { z } from 'zod'

import { setCsrfToken } from '../../../../client/settings/fetchers.js'
import ToolsSection from '../../../../client/settings/sections/ToolsSection.svelte'
import { restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

const json = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

// Three-state payload using new schema
const toolsPayload = {
  contextId: 'user:1',
  domains: [
    {
      domain: 'task',
      summary: 'partial',
      tools: [
        { name: 'create_task', permission: 'allow', risk: 'write' },
        { name: 'delete_task', permission: 'deny', risk: 'destructive' },
      ],
    },
  ],
}

const ToggleBodySchema = z.union([
  z.object({ kind: z.literal('tool'), tool: z.string(), permission: z.string(), contextId: z.string() }),
  z.object({ kind: z.literal('domain'), domain: z.string(), permission: z.string(), contextId: z.string() }),
])

let capturedBody: unknown = null
const captureToggleMock = (url: string, init: RequestInit): Promise<Response> => {
  if (url.includes('/tools/toggle')) {
    capturedBody = typeof init.body === 'string' ? JSON.parse(init.body) : init.body
  }
  return Promise.resolve(json(toolsPayload))
}

const errorToggleMock = (url: string, _init: RequestInit): Promise<Response> => {
  if (url.includes('/tools/toggle')) return Promise.resolve(new Response('Internal Server Error', { status: 500 }))
  return Promise.resolve(json(toolsPayload))
}

afterEach(() => {
  capturedBody = null
  restoreFetch()
  setCsrfToken('')
})

describe('ToolsSection', () => {
  test('renders domains and per-tool risk', async () => {
    setMockFetch(() => Promise.resolve(json(toolsPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ToolsSection, { target, props: { contextId: 'user:1' } })
    await drain()
    expect(target.textContent).toContain('task')
    expect(target.querySelector('[data-testid="domain-toggle-task"]')).not.toBeNull()
    target.querySelector<HTMLButtonElement>('[data-testid="domain-expand-task"]')!.click()
    flushSync()
    expect(target.textContent).toContain('create_task')
    expect(target.textContent).toContain('destructive')
    void unmount(component)
  })

  test('per-tool permission renders a segmented control with the active state checked', async () => {
    setMockFetch(() => Promise.resolve(json(toolsPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ToolsSection, { target, props: { contextId: 'user:1' } })
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="domain-expand-task"]')!.click()
    flushSync()
    const allow = target.querySelector('[data-testid="tool-perm-create_task-allow"]')!
    expect(allow.getAttribute('aria-checked')).toBe('true')
    expect(target.querySelector('[data-testid="tool-perm-delete_task-deny"]')!.getAttribute('aria-checked')).toBe(
      'true',
    )
    void unmount(component)
  })

  test('setting a tool permission posts with permission field', async () => {
    setCsrfToken('c')
    setMockFetch(captureToggleMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ToolsSection, { target, props: { contextId: 'user:1' } })
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="domain-expand-task"]')!.click()
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="tool-perm-create_task-deny"]')!.click()
    await drain()
    const parsed = ToggleBodySchema.parse(capturedBody)
    expect(parsed.kind).toBe('tool')
    expect(parsed.permission).toBe('deny')
    expect(parsed.contextId).toBe('user:1')
    void unmount(component)
  })

  test('setting a domain permission posts with permission field', async () => {
    setCsrfToken('c')
    setMockFetch(captureToggleMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ToolsSection, { target, props: { contextId: 'user:1' } })
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="domain-toggle-task"]')!.click()
    await drain()
    const parsed = ToggleBodySchema.parse(capturedBody)
    expect(parsed.kind).toBe('domain')
    expect(['allow', 'ask', 'deny']).toContain(parsed.permission)
    expect(parsed.contextId).toBe('user:1')
    void unmount(component)
  })

  test('a failed toggle keeps the domain list visible and shows an error', async () => {
    setCsrfToken('c')
    setMockFetch(errorToggleMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ToolsSection, { target, props: { contextId: 'user:1' } })
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="domain-toggle-task"]')!.click()
    await drain()
    expect(target.querySelector('.status-error')).not.toBeNull()
    expect(target.querySelector('[data-testid="domain-toggle-task"]')).not.toBeNull()
    void unmount(component)
  })

  test('domain toggle button reflects summary state', async () => {
    setMockFetch(() => Promise.resolve(json(toolsPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ToolsSection, { target, props: { contextId: 'user:1' } })
    await drain()
    // The domain-toggle button should show the current summary
    const toggleBtn = target.querySelector('[data-testid="domain-toggle-task"]')
    expect(toggleBtn).not.toBeNull()
    // summary is 'partial' — button label should reflect cycling action
    expect(toggleBtn!.textContent).toBeTruthy()
    void unmount(component)
  })

  test('renders section header via PageHeader', async () => {
    setMockFetch(() => Promise.resolve(json(toolsPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ToolsSection, { target, props: { contextId: 'user:1' } })
    await drain()
    expect(target.querySelector('.ui-page-header__title')?.textContent).toContain('Tools')
    void unmount(component)
  })

  test('renders domain summary as a Pill and per-tool permission segmented control', async () => {
    setMockFetch(() => Promise.resolve(json(toolsPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ToolsSection, { target, props: { contextId: 'user:1' } })
    await drain()
    // Domain summary should be rendered as a Pill (has ui-pill class)
    const summaryEl = target.querySelector('[data-testid="domain-summary-task"]')
    expect(summaryEl).not.toBeNull()
    expect(summaryEl!.querySelector('.ui-pill')).not.toBeNull()
    // Expand domain to reveal per-tool segmented control
    target.querySelector<HTMLButtonElement>('[data-testid="domain-expand-task"]')!.click()
    flushSync()
    // Per-tool permission rendered as segmented control with radiogroup role
    const radiogroup = target.querySelector('[role="radiogroup"]')
    expect(radiogroup).not.toBeNull()
    const allowBtn = target.querySelector('[data-testid="tool-perm-create_task-allow"]')
    expect(allowBtn).not.toBeNull()
    expect(allowBtn!.getAttribute('role')).toBe('radio')
    void unmount(component)
  })
})
