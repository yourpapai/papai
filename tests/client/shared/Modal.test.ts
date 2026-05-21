// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import ModalTestHelper from './ModalTestHelper.svelte'

describe('Modal.svelte', () => {
  test('renders title and content when open', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.getElementById('root')!
    let closed = false
    const component = mount(ModalTestHelper, {
      target,
      props: {
        open: true,
        title: 'Test Modal',
        onClose: () => {
          closed = true
        },
      },
    })
    expect(target.innerHTML).toContain('Test Modal')
    expect(target.innerHTML).toContain('Modal Content')
    expect(closed).toBe(false)
    void unmount(component)
  })
})
