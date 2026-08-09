// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import { setCsrfToken } from '../../../../client/settings/fetchers.js'
import CodingMcpSection from '../../../../client/settings/sections/CodingMcpSection.svelte'
import { restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

const json = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const mcpPayload = {
  namespace: 'mcp',
  configured: true,
  complete: true,
  missing: [],
  fields: [],
  catalog: [
    { name: 'search', upstream_url: 'https://search.example/sse', default_tool_policy: 'ask' },
    { name: 'docs', upstream_url: 'https://docs.example/sse', default_tool_policy: 'ask' },
  ],
  pluginServers: [{ name: 'plugin:synthetic-web-search', label: 'Synthetic Web Search' }],
  maxMcpServers: 3,
  selections: [{ server: 'search', hasToken: true }],
}

const loadedMock = (): Promise<Response> => Promise.resolve(json(mcpPayload))

function mountSection(): { target: HTMLElement; component: Record<string, unknown> } {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  const component = mount(CodingMcpSection, { target, props: { contextId: 'ctx-1' } })
  return { target, component }
}

function pickServer(target: HTMLElement, index: number, value: string): void {
  const select = target.querySelector<HTMLSelectElement>(`[data-testid="coding-mcp-server-${index}"]`)!
  select.value = value
  select.dispatchEvent(new Event('change', { bubbles: true }))
}

function rowError(target: HTMLElement, index: number): string {
  const row = target.querySelector<HTMLElement>(`[data-testid="coding-mcp-row-${index}"]`)!
  return row.querySelector<HTMLElement>('.ui-field__error')!.textContent.trim()
}

function saveButton(target: HTMLElement): HTMLButtonElement {
  return target.querySelector<HTMLButtonElement>('[data-testid="coding-mcp-save"]')!
}

describe('CodingMcpSection row validation', () => {
  afterEach(() => {
    restoreFetch()
    document.body.innerHTML = ''
  })

  test('a blank server row names its own blocking reason and disables Save', async () => {
    setCsrfToken('c')
    setMockFetch(loadedMock)
    const { target, component } = mountSection()
    await drain()

    target.querySelector<HTMLButtonElement>('[data-testid="coding-mcp-add"]')!.click()
    await drain()

    expect(rowError(target, 1)).toBe('Choose an MCP server.')
    expect(saveButton(target).disabled).toBe(true)
    void unmount(component)
  })

  test('a duplicate server marks the later row, not the first, and disables Save', async () => {
    setCsrfToken('c')
    setMockFetch(loadedMock)
    const { target, component } = mountSection()
    await drain()

    target.querySelector<HTMLButtonElement>('[data-testid="coding-mcp-add"]')!.click()
    await drain()
    pickServer(target, 1, 'search')
    await drain()

    expect(rowError(target, 1)).toBe('Already selected in another row.')
    expect(target.querySelector('[data-testid="coding-mcp-row-0"] .ui-field__error')!.textContent).toBe('')
    expect(saveButton(target).disabled).toBe(true)
    void unmount(component)
  })

  test('a distinct second server leaves both rows clean and enables Save', async () => {
    setCsrfToken('c')
    setMockFetch(loadedMock)
    const { target, component } = mountSection()
    await drain()

    target.querySelector<HTMLButtonElement>('[data-testid="coding-mcp-add"]')!.click()
    await drain()
    pickServer(target, 1, 'docs')
    await drain()

    expect([...target.querySelectorAll('.ui-field__error')].every((n) => n.textContent === '')).toBe(true)
    expect(saveButton(target).disabled).toBe(false)
    void unmount(component)
  })
})

describe('CodingMcpSection cap counter', () => {
  afterEach(() => {
    restoreFetch()
    document.body.innerHTML = ''
  })

  test('a finite cap is stated as a used-of-total count', async () => {
    setCsrfToken('c')
    setMockFetch(loadedMock)
    const { target, component } = mountSection()
    await drain()

    const cap = target.querySelector<HTMLElement>('[data-testid="coding-mcp-cap"]')!
    expect(cap.textContent.trim()).toBe('1 of 3 servers used')
    void unmount(component)
  })

  test('the count tracks rows as they are added', async () => {
    setCsrfToken('c')
    setMockFetch(loadedMock)
    const { target, component } = mountSection()
    await drain()

    target.querySelector<HTMLButtonElement>('[data-testid="coding-mcp-add"]')!.click()
    await drain()

    expect(target.querySelector<HTMLElement>('[data-testid="coding-mcp-cap"]')!.textContent.trim()).toBe(
      '2 of 3 servers used',
    )
    void unmount(component)
  })

  test('an absent cap renders no count rather than an infinite one', async () => {
    setCsrfToken('c')
    // JSON.stringify drops undefined-valued keys, so this serializes without the field —
    // exactly the optional-cap payload the client schema permits.
    setMockFetch(() => Promise.resolve(json({ ...mcpPayload, maxMcpServers: undefined })))
    const { target, component } = mountSection()
    await drain()

    expect(target.querySelector('[data-testid="coding-mcp-cap"]')).toBeNull()
    expect(target.textContent).not.toContain('∞')
    void unmount(component)
  })
})

const hangingPatchMock = (url: string, init: RequestInit): Promise<Response> => {
  if (url.includes('/coding-credentials') && init.method === 'PATCH') {
    return new Promise<Response>(() => {})
  }
  return Promise.resolve(json(mcpPayload))
}

describe('CodingMcpSection in-flight control state', () => {
  afterEach(() => {
    restoreFetch()
    document.body.innerHTML = ''
  })

  test('Save announces its in-flight state with aria-busy', async () => {
    setCsrfToken('c')
    setMockFetch(hangingPatchMock)
    const { target, component } = mountSection()
    await drain()

    target.querySelector<HTMLButtonElement>('[data-testid="coding-mcp-add"]')!.click()
    await drain()
    pickServer(target, 1, 'docs')
    await drain()

    const save = saveButton(target)
    expect(save.getAttribute('aria-busy')).toBe('false')
    save.click()
    await drain()

    expect(save.textContent.trim()).toBe('Saving…')
    expect(save.getAttribute('aria-busy')).toBe('true')
    void unmount(component)
  })

  test('Remove is disabled while a save is in flight', async () => {
    setCsrfToken('c')
    setMockFetch(hangingPatchMock)
    const { target, component } = mountSection()
    await drain()

    target.querySelector<HTMLButtonElement>('[data-testid="coding-mcp-add"]')!.click()
    await drain()
    pickServer(target, 1, 'docs')
    await drain()

    const remove = target.querySelector<HTMLButtonElement>('[data-testid="coding-mcp-remove-0"]')!
    expect(remove.disabled).toBe(false)
    saveButton(target).click()
    await drain()

    expect(remove.disabled).toBe(true)
    void unmount(component)
  })

  test('Clear announces its in-flight state with aria-busy', async () => {
    setCsrfToken('c')
    setMockFetch(hangingPatchMock)
    const { target, component } = mountSection()
    await drain()

    const clear = target.querySelector<HTMLButtonElement>('[data-testid="coding-mcp-clear"]')!
    expect(clear.getAttribute('aria-busy')).toBe('false')
    clear.click()
    await drain()

    target.querySelector<HTMLButtonElement>('[data-testid="confirm-accept"]')!.click()
    await drain()

    expect(clear.textContent.trim()).toBe('Clearing…')
    expect(clear.getAttribute('aria-busy')).toBe('true')
    void unmount(component)
  })
})

describe('CodingMcpSection empty-row Save guard', () => {
  afterEach(() => {
    restoreFetch()
    document.body.innerHTML = ''
  })

  test('removing the last row on a configured context leaves Save disabled', async () => {
    setCsrfToken('c')
    setMockFetch(loadedMock)
    const { target, component } = mountSection()
    await drain()

    target.querySelector<HTMLButtonElement>('[data-testid="coding-mcp-remove-0"]')!.click()
    await drain()

    expect(target.querySelector('[data-testid="coding-mcp-row-0"]')).toBeNull()
    expect(saveButton(target).disabled).toBe(true)
    void unmount(component)
  })

  test('an unconfigured context that has rows added and then removed is unaffected', async () => {
    setCsrfToken('c')
    setMockFetch(() => Promise.resolve(json({ ...mcpPayload, configured: false })))
    const { target, component } = mountSection()
    await drain()

    target.querySelector<HTMLButtonElement>('[data-testid="coding-mcp-add"]')!.click()
    await drain()
    pickServer(target, 1, 'docs')
    await drain()

    target.querySelector<HTMLButtonElement>('[data-testid="coding-mcp-remove-1"]')!.click()
    await drain()
    target.querySelector<HTMLButtonElement>('[data-testid="coding-mcp-remove-0"]')!.click()
    await drain()

    expect(target.querySelector('[data-testid="coding-mcp-row-0"]')).toBeNull()
    expect(saveButton(target).disabled).toBe(false)
    void unmount(component)
  })
})

describe('CodingMcpSection dead-end states', () => {
  afterEach(() => {
    restoreFetch()
    document.body.innerHTML = ''
  })

  test('a load failure names the failed operation and demotes the exception', async () => {
    setCsrfToken('c')
    setMockFetch(() => Promise.resolve(new Response('boom', { status: 500 })))
    const { target, component } = mountSection()
    await drain()

    expect(target.querySelector<HTMLElement>('.ui-error__message')!.textContent.trim()).toBe(
      "Couldn't load the MCP server settings for this context.",
    )
    expect(target.querySelector('.ui-error__detail')).not.toBeNull()
    void unmount(component)
  })

  test('an empty selection offers a next step instead of a bare gap', async () => {
    setCsrfToken('c')
    setMockFetch(() => Promise.resolve(json({ ...mcpPayload, configured: false, selections: [] })))
    const { target, component } = mountSection()
    await drain()

    expect(target.querySelector<HTMLElement>('.ui-empty__title')!.textContent.trim()).toBe('No MCP servers selected')
    void unmount(component)
  })

  test('an empty catalog is a titled dead end, not a dim line', async () => {
    setCsrfToken('c')
    setMockFetch(() => Promise.resolve(json({ ...mcpPayload, catalog: [], pluginServers: [], selections: [] })))
    const { target, component } = mountSection()
    await drain()

    const empty = target.querySelector<HTMLElement>('[data-testid="coding-mcp-catalog-empty"]')!
    expect(empty.querySelector<HTMLElement>('.ui-empty__title')!.textContent.trim()).toBe('No MCP servers available')
    void unmount(component)
  })
})
