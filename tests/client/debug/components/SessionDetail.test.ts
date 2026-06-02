// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import SessionDetail from '../../../../client/debug/components/SessionDetail.svelte'
import type { Session } from '../../../../client/debug/dashboard-types.js'

const baseSession: Session = {
  userId: 'u1',
  lastAccessed: 0,
  historyLength: 3,
  factsCount: 1,
  summary: null,
  configKeys: ['tz'],
  hasTools: true,
  config: { tz: 'UTC' },
  facts: [],
  instructions: [],
  history: [],
}

describe('SessionDetail', () => {
  test('renders Basic Info as a SummaryList and config as a DataTable', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(SessionDetail, { target, props: { userId: 'u1', session: baseSession } })
    expect(target.querySelector('.ui-summary')).not.toBeNull()
    expect(target.querySelector('.ui-datatable')).not.toBeNull()
    void unmount(c)
  })
})
