// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, expect, mock, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

void mock.module('../../../../client/admin/plugin-config-fetchers.js', () => ({
  fetchAdminPluginConfig: (): Promise<{ plugins: never[] }> => Promise.resolve({ plugins: [] }),
}))

const { default: PluginConfigSection } = await import('../../../../client/admin/sections/PluginConfigSection.svelte')

const render = (): { readonly component: ReturnType<typeof mount>; readonly target: HTMLElement } => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')
  if (target === null) throw new Error('root missing')
  const component = mount(PluginConfigSection, { target })
  flushSync()
  return { component, target }
}

afterEach(() => {
  document.body.innerHTML = ''
})

test('renders the Plugin Config header via PageHeader', () => {
  const { component, target } = render()
  expect(target.querySelector('[data-testid="admin-section-title"]')?.textContent).toBe('Plugin Config')
  expect(target.querySelector('.ui-page-header')).not.toBeNull()
  expect(target.querySelector('[data-testid="plugin-config-refresh"]')).not.toBeNull()
  void unmount(component)
})
