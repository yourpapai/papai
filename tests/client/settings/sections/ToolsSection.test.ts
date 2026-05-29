// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import { setCsrfToken } from '../../../../client/settings/fetchers.js'
import ToolsSection from '../../../../client/settings/sections/ToolsSection.svelte'
import { restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

const json = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const toolsPayload = {
  contextId: 'user:1',
  domains: [
    {
      domain: 'task',
      status: 'partial',
      tools: [
        { name: 'create_task', enabled: true, risk: 'write' },
        { name: 'delete_task', enabled: false, risk: 'destructive' },
      ],
    },
  ],
}

const extractStringBody = (init: RequestInit): string => (typeof init.body === 'string' ? init.body : '')

let capturedBody = ''
const captureToggleMock = (url: string, init: RequestInit): Promise<Response> => {
  if (url.includes('/tools/toggle')) capturedBody = extractStringBody(init)
  return Promise.resolve(json(toolsPayload))
}

afterEach(() => {
  capturedBody = ''
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
    expect(target.textContent).toContain('create_task')
    expect(target.textContent).toContain('destructive')
    void unmount(component)
  })

  test('toggling a tool posts kind=tool', async () => {
    setCsrfToken('c')
    setMockFetch(captureToggleMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ToolsSection, { target, props: { contextId: 'user:1' } })
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="tool-toggle-create_task"]')!.click()
    await drain()
    expect(capturedBody).toBe(JSON.stringify({ kind: 'tool', tool: 'create_task', contextId: 'user:1' }))
    void unmount(component)
  })
})
