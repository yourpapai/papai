// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import ReleaseSubscriptionSection from '../../../client/settings/sections/ReleaseSubscriptionSection.svelte'
import { restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

const json = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

afterEach(() => {
  restoreFetch()
})

describe('ReleaseSubscriptionSection', () => {
  test('personal scope reads /settings/api/release-subscription and shows the toggle', async () => {
    const urls: string[] = []
    setMockFetch((url) => {
      urls.push(url)
      return Promise.resolve(json({ enabled: false }))
    })
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ReleaseSubscriptionSection, { target, props: { scope: 'personal', contextId: 'u1' } })

    await drain()

    expect(urls.some((u) => u.endsWith('/settings/api/release-subscription'))).toBe(true)
    expect(target.querySelector('[data-testid="release-subscription-toggle"]')).not.toBeNull()
    void unmount(component)
  })

  test('group scope reads /settings/api/group/release-subscription with contextId', async () => {
    const urls: string[] = []
    setMockFetch((url) => {
      urls.push(url)
      return Promise.resolve(json({ contextId: 'g1', enabled: true }))
    })
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ReleaseSubscriptionSection, { target, props: { scope: 'group', contextId: 'g1' } })

    await drain()

    expect(urls.some((u) => u.includes('/settings/api/group/release-subscription'))).toBe(true)
    expect(urls.some((u) => u.includes('contextId=g1'))).toBe(true)
    void unmount(component)
  })
})
