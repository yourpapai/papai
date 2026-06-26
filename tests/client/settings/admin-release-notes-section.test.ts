// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import AdminReleaseNotesSection from '../../../client/settings/sections/admin/AdminReleaseNotesSection.svelte'
import { restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

const json = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })

const drain = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  flushSync()
}

const releaseNotesPayload = {
  version: '1.2.3',
  body: 'This release includes new features.',
  broadcastAt: null,
  counts: { dm: 5, group: 3 },
}

afterEach(() => {
  restoreFetch()
})

describe('AdminReleaseNotesSection', () => {
  test('loads and renders release notes version and body', async () => {
    setMockFetch(() => Promise.resolve(json(releaseNotesPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminReleaseNotesSection, { target })

    await drain()

    expect(target.querySelector('#release-notes')).not.toBeNull()
    expect(target.textContent).toContain('1.2.3')
    expect(target.querySelector('[data-testid="release-notes-body"]')).not.toBeNull()
    void unmount(component)
  })

  test('shows subscriber counts', async () => {
    setMockFetch(() => Promise.resolve(json(releaseNotesPayload)))
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminReleaseNotesSection, { target })

    await drain()

    expect(target.textContent).toContain('5')
    expect(target.textContent).toContain('3')
    void unmount(component)
  })

  test('shows already broadcast indicator when broadcastAt is set', async () => {
    setMockFetch(() =>
      Promise.resolve(
        json({
          ...releaseNotesPayload,
          broadcastAt: '2026-01-01T00:00:00.000Z',
        }),
      ),
    )
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(AdminReleaseNotesSection, { target })

    await drain()

    expect(target.textContent).toContain('already broadcast')
    void unmount(component)
  })
})
