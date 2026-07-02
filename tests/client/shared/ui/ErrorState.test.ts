// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import ErrorState from '../../../../client/shared/ui/ErrorState.svelte'

function render(props: Record<string, unknown>): { target: HTMLElement; component: ReturnType<typeof mount> } {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.body.querySelector<HTMLElement>('#root')!
  return { target, component: mount(ErrorState, { target, props }) }
}

describe('ErrorState.svelte', () => {
  test('renders the message and a default title', () => {
    const { target, component } = render({ message: 'boom' })
    expect(target.querySelector('.ui-error__message')?.textContent).toContain('boom')
    expect(target.querySelector('.ui-error__title')?.textContent).toContain('Something went wrong')
    expect(target.querySelector('[data-testid="error-retry"]')).toBeNull()
    void unmount(component)
  })

  test('renders a retry button that fires onRetry when clicked', () => {
    let retried = 0
    const { target, component } = render({
      message: 'boom',
      onRetry: () => {
        retried += 1
      },
    })
    const retry = target.querySelector<HTMLButtonElement>('[data-testid="error-retry"]')
    expect(retry).not.toBeNull()
    expect(retry!.textContent).toContain('Try again')
    retry!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(retried).toBe(1)
    void unmount(component)
  })
})
