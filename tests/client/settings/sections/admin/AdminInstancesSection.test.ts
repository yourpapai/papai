// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import AdminInstancesSection from '../../../../../client/settings/sections/admin/AdminInstancesSection.svelte'
import { restoreFetch, setMockFetch } from '../../../../utils/test-helpers.js'

const json = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 12; i++) await Promise.resolve()
  flushSync()
}

const installFetch = (): void => {
  setMockFetch((url) => {
    if (url.includes('/admin/platform-instances'))
      return Promise.resolve(
        json({ instances: [{ id: 'tg', type: 'telegram', status: 'active', config: {}, createdAt: 1 }] }),
      )
    if (url.includes('/admin/task-instances'))
      return Promise.resolve(
        json({ instances: [{ id: 'k', type: 'kaneo', status: 'active', config: {}, createdAt: 1 }] }),
      )
    if (url.includes('/admin/platform-provider-types'))
      return Promise.resolve(
        json({ providerTypes: [{ type: 'telegram', displayName: 'Telegram', instanceConfigSchema: [] }] }),
      )
    if (url.includes('/admin/task-provider-types'))
      return Promise.resolve(
        json({ providerTypes: [{ type: 'kaneo', displayName: 'Kaneo', instanceConfigSchema: [] }] }),
      )
    return Promise.resolve(json({}))
  })
}

afterEach(() => {
  restoreFetch()
})

describe('AdminInstancesSection', () => {
  test('renders platform and task instance rows', async () => {
    installFetch()
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminInstancesSection, { target })
    await drain()
    expect(target.querySelector('#instances')).not.toBeNull()
    expect(target.textContent).toContain('tg')
    expect(target.textContent).toContain('kaneo')
    void unmount(component)
  })
})
