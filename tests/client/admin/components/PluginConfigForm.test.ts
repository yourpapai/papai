// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import PluginConfigForm from '../../../../client/admin/components/PluginConfigForm.svelte'
import type { AdminPluginConfigSnapshot } from '../../../../client/shared/api-types.js'

const sensitiveSnapshot: AdminPluginConfigSnapshot = {
  plugins: [
    {
      pluginId: 'p',
      keys: [{ key: 'tok', label: 'Token', value: '••••', required: true, sensitive: true }],
    },
  ],
}

type Mounted = {
  target: HTMLElement
  component: ReturnType<typeof mount>
}

const render = (snapshot: AdminPluginConfigSnapshot | null): Mounted => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')
  if (target === null) throw new Error('root missing')
  const component = mount(PluginConfigForm, {
    target,
    props: {
      snapshot,
      onRefresh: () => Promise.resolve(),
    },
  })
  return { target, component }
}

describe('PluginConfigForm', () => {
  test('does not render an h3 with text "Plugin configuration"', () => {
    const { target, component } = render(sensitiveSnapshot)
    const hasHeading = [...target.querySelectorAll('h3')].some((h) => h.textContent === 'Plugin configuration')
    expect(hasHeading).toBe(false)
    void unmount(component)
  })

  test('renders a ui-panel for each plugin group', () => {
    const { target, component } = render(sensitiveSnapshot)
    expect(target.querySelector('.ui-panel')).not.toBeNull()
    void unmount(component)
  })

  test('sensitive key with value renders as ui-secret component', () => {
    const { target, component } = render(sensitiveSnapshot)
    expect(target.querySelector('.ui-secret')).not.toBeNull()
    void unmount(component)
  })

  test('edit button has class ui-btn', () => {
    const { target, component } = render(sensitiveSnapshot)
    const editBtn = target.querySelector('[data-testid^="edit-"]')
    expect(editBtn).not.toBeNull()
    expect(editBtn?.classList.contains('ui-btn')).toBe(true)
    void unmount(component)
  })

  test('renders loading placeholder when snapshot is null', () => {
    const { target, component } = render(null)
    expect(target.textContent).toContain('Loading')
    void unmount(component)
  })

  test('renders empty state when snapshot has no plugins', () => {
    const { target, component } = render({ plugins: [] })
    expect(target.textContent).toContain('No plugins')
    void unmount(component)
  })
})
