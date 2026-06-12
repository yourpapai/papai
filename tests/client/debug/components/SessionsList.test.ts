// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import SessionsList from '../../../../client/debug/components/SessionsList.svelte'

describe('SessionsList', () => {
  test('renders the sessions list within a Panel', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(SessionsList, {
      target,
      props: { dashboard: { sessions: new Map(), wizards: new Map() }, onSelect: () => {} },
    })
    expect(target.querySelector('.ui-panel')).not.toBeNull()
    void unmount(c)
  })
})
