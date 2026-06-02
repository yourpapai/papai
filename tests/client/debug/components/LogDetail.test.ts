// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import LogDetail from '../../../../client/debug/components/LogDetail.svelte'

describe('LogDetail', () => {
  test('renders the meta block as a SummaryList with the level as a pill', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(LogDetail, {
      target,
      props: { entry: { time: 0, level: 40, msg: 'x', scope: 's' } },
    })
    expect(target.querySelector('.ui-summary')).not.toBeNull()
    expect(target.querySelector('.ui-pill')).not.toBeNull()
    void unmount(c)
  })
})
