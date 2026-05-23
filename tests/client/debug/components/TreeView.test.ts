// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import TreeView from '../../../../client/shared/TreeView.svelte'

function render(value: unknown): { target: HTMLElement; component: ReturnType<typeof mount> } {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.getElementById('root')!
  const component = mount(TreeView, { target, props: { value } })
  return { target, component }
}

describe('TreeView', () => {
  test('renders a string primitive', () => {
    const { target, component } = render('hello')
    expect(target.textContent).toContain('hello')
    expect(target.querySelector('.tree-string')).not.toBeNull()
    void unmount(component)
  })

  test('renders a number primitive with number class', () => {
    const { target, component } = render(42)
    expect(target.querySelector('.tree-number')?.textContent).toBe('42')
    void unmount(component)
  })

  test('renders null with null class', () => {
    const { target, component } = render(null)
    expect(target.querySelector('.tree-null')).not.toBeNull()
    void unmount(component)
  })

  test('renders empty object with brackets only', () => {
    const { target, component } = render({})
    expect(target.querySelector('.tree-bracket')?.textContent).toBe('{}')
    void unmount(component)
  })

  test('renders object with toggle and key', () => {
    const { target, component } = render({ name: 'Alice', age: 30 })
    expect(target.querySelector('.tree-toggle')).not.toBeNull()
    expect(target.textContent).toContain('name')
    expect(target.textContent).toContain('Alice')
    void unmount(component)
  })

  test('renders array with index keys', () => {
    const { target, component } = render(['a', 'b', 'c'])
    expect(target.textContent).toContain('0')
    expect(target.textContent).toContain('a')
    expect(target.querySelector('.tree-bracket')?.textContent).toBe('[')
    void unmount(component)
  })

  test('handles deeply nested objects without crashing', () => {
    // Build a 60-level nested object
    let nested: Record<string, unknown> = { value: 'deep' }
    for (let i = 0; i < 59; i++) {
      nested = { child: nested }
    }

    // Should not throw or overflow the stack
    const { target, component } = render(nested)
    expect(target.textContent).toContain('child')
    void unmount(component)
  })
})
