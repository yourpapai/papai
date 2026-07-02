// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import AiOutputSection from '../../../../client/settings/sections/AiOutputSection.svelte'
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
      key: 'ai_tool_visibility',
      storageKey: 'ai_tool_visibility',
      label: 'Show tool calls',
      required: false,
      sensitive: false,
      kind: 'ai-output',
      control: 'toggle',
      options: [
        { value: 'off', label: 'Off' },
        { value: 'on', label: 'On' },
      ],
      hasValue: false,
      value: '',
    },
    {
      key: 'ai_reasoning_visibility',
      storageKey: 'ai_reasoning_visibility',
      label: 'Show reasoning',
      required: false,
      sensitive: false,
      kind: 'ai-output',
      control: 'toggle',
      options: [
        { value: 'off', label: 'Off' },
        { value: 'on', label: 'On' },
      ],
      hasValue: false,
      value: '',
    },
    {
      key: 'ai_output_detail_level',
      storageKey: 'ai_output_detail_level',
      label: 'Detail level',
      required: false,
      sensitive: false,
      kind: 'ai-output',
      control: 'select',
      options: [
        { value: 'sanitized', label: 'Sanitized' },
        { value: 'raw', label: 'Raw' },
      ],
      hasValue: false,
      value: '',
    },
  ],
}

afterEach(() => {
  restoreFetch()
})

describe('AiOutputSection', () => {
  test('renders only ai-output fields and defaults an empty value to the first option', async () => {
    setMockFetch(() => Promise.resolve(json(configPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AiOutputSection, { target, props: { contextId: 'user:1' } })
    await drain()

    expect(target.querySelector('#ai-output')).not.toBeNull()
    expect(target.querySelector('[data-testid="cfg-row-ai_tool_visibility"]')).not.toBeNull()
    expect(target.querySelector('[data-testid="cfg-row-ai_output_detail_level"]')).not.toBeNull()
    expect(target.querySelector('[data-testid="cfg-row-ai_reasoning_visibility"]')).not.toBeNull()
    // preference fields are excluded
    expect(target.querySelector('[data-testid="cfg-row-timezone"]')).toBeNull()

    // empty value defaults to the first option (off / sanitized)
    const offBtn = target.querySelector<HTMLButtonElement>('[data-testid="cfg-seg-ai_tool_visibility-off"]')!
    expect(offBtn.getAttribute('aria-checked')).toBe('true')
    const sanitizedBtn = target.querySelector<HTMLButtonElement>(
      '[data-testid="cfg-seg-ai_output_detail_level-sanitized"]',
    )!
    expect(sanitizedBtn.getAttribute('aria-checked')).toBe('true')
    void unmount(component)
  })

  test('shows an error message when the config fetch fails', async () => {
    setMockFetch(() => Promise.resolve(new Response('Internal Server Error', { status: 500 })))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AiOutputSection, { target, props: { contextId: 'user:1' } })
    await drain()
    expect(target.querySelector('.ui-error')).not.toBeNull()
    expect(target.querySelector('.ui-empty')).toBeNull()
    void unmount(component)
  })

  test('renders the refresh control as an icon button', () => {
    setMockFetch(() => Promise.resolve(json(configPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AiOutputSection, { target, props: { contextId: 'ctx' } })
    expect(target.querySelector('[data-testid="ai-output-refresh"]')).not.toBeNull()
    void unmount(component)
  })

  test('renders section header via PageHeader', async () => {
    setMockFetch(() => Promise.resolve(json(configPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AiOutputSection, { target, props: { contextId: 'user:1' } })
    await drain()
    expect(target.querySelector('.ui-page-header__title')?.textContent).toContain('AI output')
    void unmount(component)
  })
})
