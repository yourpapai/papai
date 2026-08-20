// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import SettingsGroupToggle from '../../../../client/settings/components/SettingsGroupToggle.svelte'

const props = {
  label: 'Advanced',
  hint: 'Memory, AI output, Identity + 7 more',
  collapsed: true,
  controls: 'settings-advanced-content',
  testid: 'advanced-toggle',
  onToggle: (): void => undefined,
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('SettingsGroupToggle', () => {
  test('renders a button wired to the content it controls', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const c = mount(SettingsGroupToggle, { target, props })
    flushSync()
    const button = target.querySelector<HTMLButtonElement>('[data-testid="advanced-toggle"]')!
    expect(button.tagName).toBe('BUTTON')
    expect(button.getAttribute('type')).toBe('button')
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(button.getAttribute('aria-controls')).toBe('settings-advanced-content')
    void unmount(c)
  })

  test('shows the label and the derived hint', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const c = mount(SettingsGroupToggle, { target, props })
    flushSync()
    expect(target.textContent).toContain('Advanced')
    expect(target.textContent).toContain('Memory, AI output, Identity + 7 more')
    void unmount(c)
  })

  test('an expanded toggle reports aria-expanded true', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const c = mount(SettingsGroupToggle, { target, props: { ...props, collapsed: false } })
    flushSync()
    expect(target.querySelector('[data-testid="advanced-toggle"]')!.getAttribute('aria-expanded')).toBe('true')
    void unmount(c)
  })

  test('clicking calls onToggle exactly once', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    let calls = 0
    const c = mount(SettingsGroupToggle, {
      target,
      props: {
        ...props,
        onToggle: (): void => {
          calls += 1
        },
      },
    })
    flushSync()
    target.querySelector<HTMLButtonElement>('[data-testid="advanced-toggle"]')!.click()
    flushSync()
    expect(calls).toBe(1)
    void unmount(c)
  })

  test('SettingsGroupToggle.svelte source declares a :focus-visible ring using the shared tokens', async () => {
    const url = new URL('../../../../client/settings/components/SettingsGroupToggle.svelte', import.meta.url)
    const source = await Bun.file(url).text()
    expect(source).toContain('.settings-group-toggle:focus-visible')
    const match = source.match(/\.settings-group-toggle:focus-visible\s*\{[^}]*\}/u)
    expect(match).not.toBeNull()
    const [rule] = match!
    expect(rule).toContain('outline: var(--focus-ring)')
    expect(rule).toContain('outline-offset: var(--focus-ring-offset)')
  })
})
