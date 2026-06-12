// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import { setCsrfToken } from '../../../../../client/settings/fetchers.js'
import AdminFeatureFlagsSection from '../../../../../client/settings/sections/admin/AdminFeatureFlagsSection.svelte'
import { restoreFetch, setMockFetch } from '../../../../utils/test-helpers.js'

const json = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const oneRowSnapshot = {
  killSwitchEngaged: false,
  contexts: [
    {
      contextId: 'ctx-1',
      kind: 'user',
      label: 'Alice',
      platformInstanceLabel: 'Telegram',
      flags: { result_compaction: false, progressive_disclosure: false, semantic_tool_retrieval: false },
    },
  ],
}

const killSwitchSnapshot = {
  killSwitchEngaged: true,
  contexts: [
    {
      contextId: 'ctx-1',
      kind: 'user',
      label: 'Alice',
      platformInstanceLabel: 'Telegram',
      flags: { result_compaction: false, progressive_disclosure: false, semantic_tool_retrieval: false },
    },
  ],
}

const emptySnapshot = {
  killSwitchEngaged: false,
  contexts: [],
}

let capturedPatchBody: string | undefined

const capturePatchMock = (url: string, init: RequestInit): Promise<Response> => {
  if (url.includes('/admin/feature-flags') && init.method === 'PATCH') {
    capturedPatchBody = typeof init.body === 'string' ? init.body : undefined
    return Promise.resolve(
      json({
        contextId: 'ctx-1',
        kind: 'user',
        label: 'Alice',
        platformInstanceLabel: 'Telegram',
        flags: { result_compaction: true, progressive_disclosure: false, semantic_tool_retrieval: false },
      }),
    )
  }
  return Promise.resolve(json(oneRowSnapshot))
}

afterEach(() => {
  capturedPatchBody = undefined
  restoreFetch()
  setCsrfToken('')
})

describe('AdminFeatureFlagsSection', () => {
  test('renders row label and three checkboxes; Save disabled when not dirty', async () => {
    setMockFetch(() => Promise.resolve(json(oneRowSnapshot)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminFeatureFlagsSection, { target })
    await drain()

    expect(target.querySelector('#feature-flags')).not.toBeNull()
    expect(target.textContent).toContain('Alice')

    const checkboxes = target.querySelectorAll<HTMLInputElement>(
      '[data-testid^="feature-flags-ctx-1-"] input[type="checkbox"], [data-testid^="feature-flags-ctx-1-"]',
    )
    // three flag keys: result_compaction, progressive_disclosure, semantic_tool_retrieval
    const allCheckboxes = target.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
    expect(allCheckboxes.length).toBe(3)

    const saveBtn = target.querySelector<HTMLButtonElement>('[data-testid="feature-flags-save-ctx-1"]')!
    expect(saveBtn).not.toBeNull()
    expect(saveBtn.disabled).toBe(true)

    void checkboxes
    void unmount(component)
  })

  test('killSwitchEngaged true shows TOOL_CONTEXT_REDUCTION_DISABLED banner', async () => {
    setMockFetch(() => Promise.resolve(json(killSwitchSnapshot)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminFeatureFlagsSection, { target })
    await drain()

    expect(target.textContent).toContain('TOOL_CONTEXT_REDUCTION_DISABLED')
    expect(target.querySelector('.status-error')).not.toBeNull()

    void unmount(component)
  })

  test('empty contexts renders empty-state message', async () => {
    setMockFetch(() => Promise.resolve(json(emptySnapshot)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminFeatureFlagsSection, { target })
    await drain()

    expect(target.textContent).toContain('No known contexts yet.')

    void unmount(component)
  })

  test('toggling a checkbox enables Save; clicking Save issues PATCH with drafted flags', async () => {
    setCsrfToken('c')
    setMockFetch(capturePatchMock)
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminFeatureFlagsSection, { target })
    await drain()

    const compactionCheckbox = target.querySelector<HTMLInputElement>(
      '[data-testid="feature-flags-ctx-1-result_compaction"]',
    )!
    expect(compactionCheckbox).not.toBeNull()
    compactionCheckbox.checked = true
    compactionCheckbox.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()

    const saveBtn = target.querySelector<HTMLButtonElement>('[data-testid="feature-flags-save-ctx-1"]')!
    expect(saveBtn.disabled).toBe(false)

    saveBtn.click()
    await drain()

    expect(capturedPatchBody).toBe(
      JSON.stringify({
        contextId: 'ctx-1',
        flags: { result_compaction: true, progressive_disclosure: false, semantic_tool_retrieval: false },
      }),
    )

    void unmount(component)
  })
})
