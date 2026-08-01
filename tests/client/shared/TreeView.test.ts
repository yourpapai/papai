// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import TreeView from '../../../client/shared/TreeView.svelte'

describe('TreeView.svelte', () => {
  test('expanded container renders its closing bracket on a dedicated row', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(TreeView, { target, props: { label: 'payload', value: { a: 1 } } })
    const closing = target.querySelector('.tree-closing')
    expect(closing).not.toBeNull()
    expect(closing?.textContent?.trim()).toBe('}')
    void unmount(component)
  })

  test('collapsing a container hides its closing row', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(TreeView, { target, props: { label: 'payload', value: { a: 1 } } })
    const toggle = target.querySelector<HTMLElement>('.tree-toggle')!
    toggle.click()
    flushSync()
    expect(target.querySelector('.tree-closing')).toBeNull()
    void unmount(component)
  })
})
