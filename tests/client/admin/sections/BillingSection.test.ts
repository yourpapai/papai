// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import BillingSection from '../../../../client/admin/sections/BillingSection.svelte'
import { restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const installFetch = (): void => {
  setMockFetch(() => Promise.resolve(Response.json({ window: '30d', subjects: [] })))
}

const render = (): { target: HTMLElement; component: ReturnType<typeof mount> } => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')
  if (target === null) throw new Error('root missing')
  const component = mount(BillingSection, { target })
  return { target, component }
}

afterEach(() => {
  restoreFetch()
})

describe('BillingSection (kit-adoption)', () => {
  test('billing-refresh control renders as Btn (.ui-btn)', async () => {
    installFetch()

    const { target, component } = render()
    await drain()

    const refreshEl = target.querySelector('[data-testid="billing-refresh"]')
    expect(refreshEl).not.toBeNull()
    expect(refreshEl?.classList.contains('ui-btn')).toBe(true)

    void unmount(component)
  })
})
