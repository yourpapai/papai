// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import StatusPill from '../../../../client/shared/ui/StatusPill.svelte'

function render(props: { status: string; dot?: boolean }): {
  target: HTMLElement
  component: ReturnType<typeof mount>
} {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.body.querySelector<HTMLElement>('#root')!
  const component = mount(StatusPill, { target, props })
  return { target, component }
}

describe('StatusPill.svelte', () => {
  test('renders the status text', () => {
    const { target, component } = render({ status: 'active' })
    expect(target.textContent).toContain('active')
    void unmount(component)
  })
  test('maps active to the accent pill tone', () => {
    const { target, component } = render({ status: 'active' })
    expect(target.querySelector('.ui-pill--accent')).not.toBeNull()
    void unmount(component)
  })
  test('shows a dot for active but not for mute statuses', () => {
    const { target: t1, component: c1 } = render({ status: 'active' })
    expect(t1.querySelector('.ui-dot')).not.toBeNull()
    void unmount(c1)
    const { target: t2, component: c2 } = render({ status: 'unknown' })
    expect(t2.querySelector('.ui-dot')).toBeNull()
    void unmount(c2)
  })
})
