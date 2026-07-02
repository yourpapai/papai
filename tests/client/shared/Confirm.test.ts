// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createRawSnippet, mount, unmount } from 'svelte'
import type { Snippet } from 'svelte'

import Confirm from '../../../client/shared/Confirm.svelte'

interface RenderConfirmOptions {
  open: boolean | undefined
  title: string | undefined
  onCancel: (() => void) | undefined
  onConfirm: (() => void) | undefined
  cancelLabel: string | undefined
  confirmLabel: string | undefined
  danger?: boolean
  busy?: boolean
}

function textSnippet(text: string): Snippet {
  return createRawSnippet((): { render: () => string } => ({
    render: (): string => `<div>${text}</div>`,
  }))
}

function findBtnByText(target: HTMLElement, text: string): HTMLButtonElement | null {
  const button = [...target.querySelectorAll<HTMLButtonElement>('.ui-btn')].find((node) => {
    const content = node.textContent
    if (content === null) return false
    return content.trim() === text
  })

  if (button === undefined) return null
  return button
}

function defaultRenderConfirmOptions(): RenderConfirmOptions {
  return {
    open: undefined,
    title: undefined,
    onCancel: undefined,
    onConfirm: undefined,
    cancelLabel: undefined,
    confirmLabel: undefined,
  }
}

function resolveConfirmOptions(optionsInput: RenderConfirmOptions | undefined): RenderConfirmOptions {
  if (optionsInput !== undefined) return optionsInput
  return defaultRenderConfirmOptions()
}

function resolveConfirmOpen(options: RenderConfirmOptions): boolean {
  if (options.open !== undefined) return options.open
  return true
}

function resolveConfirmTitle(options: RenderConfirmOptions): string {
  if (options.title !== undefined) return options.title
  return 'Delete item?'
}

function noop(): void {}

function resolveConfirmCancel(options: RenderConfirmOptions): () => void {
  if (options.onCancel !== undefined) return options.onCancel
  return noop
}

function resolveConfirmAction(options: RenderConfirmOptions): () => void {
  if (options.onConfirm !== undefined) return options.onConfirm
  return noop
}

function renderConfirm(optionsInput: RenderConfirmOptions | undefined): {
  target: HTMLElement
  component: ReturnType<typeof mount>
} {
  const options = resolveConfirmOptions(optionsInput)
  const open = resolveConfirmOpen(options)
  const title = resolveConfirmTitle(options)
  const onCancel = resolveConfirmCancel(options)
  const onConfirm = resolveConfirmAction(options)

  document.body.innerHTML = '<div id="root"></div>'
  const target = document.body.querySelector<HTMLElement>('#root')!
  const component = mount(Confirm, {
    target,
    props: {
      open,
      title,
      onCancel,
      onConfirm,
      cancelLabel: options.cancelLabel,
      confirmLabel: options.confirmLabel,
      danger: options.danger,
      busy: options.busy,
      body: textSnippet('Confirm Body'),
    },
  })
  return { target, component }
}

describe('Confirm.svelte', () => {
  test('renders a small modal with Cancel and Confirm actions', () => {
    const { target, component } = renderConfirm(defaultRenderConfirmOptions())

    expect(target.querySelector('.modal-content.modal--sm')).not.toBeNull()
    expect(findBtnByText(target, 'Cancel')).not.toBeNull()
    expect(findBtnByText(target, 'Confirm')).not.toBeNull()
    expect(target.textContent).toContain('Confirm Body')
    void unmount(component)
  })

  test('clicking Cancel calls onCancel only', () => {
    let cancelled = 0
    let confirmed = 0
    const { target, component } = renderConfirm({
      ...defaultRenderConfirmOptions(),
      onCancel: () => {
        cancelled += 1
      },
      onConfirm: () => {
        confirmed += 1
      },
    })

    const cancelButton = findBtnByText(target, 'Cancel')
    expect(cancelButton).not.toBeNull()
    cancelButton!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    expect(cancelled).toBe(1)
    expect(confirmed).toBe(0)
    void unmount(component)
  })

  test('clicking Confirm calls onConfirm only', () => {
    let cancelled = 0
    let confirmed = 0
    const { target, component } = renderConfirm({
      ...defaultRenderConfirmOptions(),
      onCancel: () => {
        cancelled += 1
      },
      onConfirm: () => {
        confirmed += 1
      },
    })

    const confirmButton = findBtnByText(target, 'Confirm')
    expect(confirmButton).not.toBeNull()
    confirmButton!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    expect(cancelled).toBe(0)
    expect(confirmed).toBe(1)
    void unmount(component)
  })

  test('clicking the backdrop calls onCancel', () => {
    let cancelled = 0
    const { target, component } = renderConfirm({
      ...defaultRenderConfirmOptions(),
      onCancel: () => {
        cancelled += 1
      },
    })

    const backdrop = target.querySelector('.modal')
    expect(backdrop).not.toBeNull()
    backdrop!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    expect(cancelled).toBe(1)
    void unmount(component)
  })

  test('with danger prop, the confirm button has class ui-btn--danger', () => {
    const { target, component } = renderConfirm({
      ...defaultRenderConfirmOptions(),
      danger: true,
      confirmLabel: 'Delete',
    })

    const confirmButton = findBtnByText(target, 'Delete')
    expect(confirmButton).not.toBeNull()
    expect(confirmButton!.classList.contains('ui-btn--danger')).toBe(true)
    void unmount(component)
  })

  test('busy disables both footer buttons', () => {
    const { target, component } = renderConfirm({
      ...defaultRenderConfirmOptions(),
      busy: true,
    })

    const buttons = [...target.querySelectorAll<HTMLButtonElement>('.modal-footer .ui-btn')]
    expect(buttons.length).toBe(2)
    expect(buttons.every((b) => b.disabled)).toBe(true)
    void unmount(component)
  })

  test('not busy leaves footer buttons enabled', () => {
    const { target, component } = renderConfirm(defaultRenderConfirmOptions())

    const buttons = [...target.querySelectorAll<HTMLButtonElement>('.modal-footer .ui-btn')]
    expect(buttons.some((b) => b.disabled)).toBe(false)
    void unmount(component)
  })
})
