// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import SettingsFieldShell from '../../../../client/settings/components/SettingsFieldShell.svelte'

const render = (props: Record<string, unknown>): { component: ReturnType<typeof mount>; target: HTMLElement } => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  return { component: mount(SettingsFieldShell, { target, props }), target }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('SettingsFieldShell', () => {
  test('renders the label text and the card testid', () => {
    const { component, target } = render({ label: 'Anthropic API Key', testid: 'byok-row-x' })
    flushSync()
    expect(target.querySelector('[data-testid="byok-row-x"]')).not.toBeNull()
    expect(target.querySelector('.settings-field__label')!.textContent).toContain('Anthropic API Key')
    void unmount(component)
  })

  test('renders an accent-colored required marker only when required', () => {
    const { component, target } = render({ label: 'Key', required: true })
    flushSync()
    const req = target.querySelector('.settings-field__req')
    expect(req).not.toBeNull()
    expect(req!.textContent).toBe('*')
    expect(target.querySelector('.settings-field__label')!.textContent).toContain('*')
    void unmount(component)
  })

  test('omits the required marker when not required', () => {
    const { component, target } = render({ label: 'Key', required: false })
    flushSync()
    expect(target.querySelector('.settings-field__req')).toBeNull()
    expect(target.querySelector('.settings-field__label')!.textContent).not.toContain('*')
    void unmount(component)
  })

  test('does not render an editor wrapper when no editor snippet is provided', () => {
    const { component, target } = render({ label: 'Key' })
    flushSync()
    expect(target.querySelector('.settings-field__editor')).toBeNull()
    void unmount(component)
  })
})
