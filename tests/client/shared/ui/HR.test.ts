// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import HR from '../../../../client/shared/ui/HR.svelte'

function render(props: Record<string, unknown>): { target: HTMLElement; component: ReturnType<typeof mount> } {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.body.querySelector<HTMLElement>('#root')!
  const component = mount(HR, { target, props })
  return { target, component }
}

describe('HR.svelte', () => {
  test('renders a solid hairline by default', () => {
    const { target, component } = render({})
    const hr = target.querySelector<HTMLElement>('.ui-hr')!
    expect(hr).not.toBeNull()
    expect(hr.style.borderTopStyle).toBe('solid')
    void unmount(component)
  })

  test('uses dashed style when dashed=true', () => {
    const { target, component } = render({ dashed: true })
    const hr = target.querySelector<HTMLElement>('.ui-hr')!
    expect(hr.style.borderTopStyle).toBe('dashed')
    void unmount(component)
  })
})
