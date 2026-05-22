// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createRawSnippet, mount, unmount } from 'svelte'
import type { Snippet } from 'svelte'

import Modal from '../../../client/shared/Modal.svelte'

type ModalSize = 'sm' | 'md' | 'lg' | 'xl'

interface RenderModalOptions {
  open: boolean | undefined
  title: string | undefined
  onClose: (() => void) | undefined
  size: ModalSize | undefined
  footer: Snippet | undefined
}

function textSnippet(text: string): Snippet {
  return createRawSnippet((): { render: () => string } => ({ render: (): string => `<div>${text}</div>` }))
}

function defaultRenderModalOptions(): RenderModalOptions {
  return {
    open: undefined,
    title: undefined,
    onClose: undefined,
    size: undefined,
    footer: undefined,
  }
}

function resolveModalOptions(optionsInput: RenderModalOptions | undefined): RenderModalOptions {
  if (optionsInput !== undefined) return optionsInput
  return defaultRenderModalOptions()
}

function resolveModalOpen(options: RenderModalOptions): boolean {
  if (options.open !== undefined) return options.open
  return true
}

function resolveModalTitle(options: RenderModalOptions): string {
  if (options.title !== undefined) return options.title
  return 'Test Modal'
}

function noop(): void {}

function resolveModalOnClose(options: RenderModalOptions): () => void {
  if (options.onClose !== undefined) return options.onClose
  return noop
}

function renderModal(optionsInput: RenderModalOptions | undefined): {
  target: HTMLElement
  component: ReturnType<typeof mount>
} {
  const options = resolveModalOptions(optionsInput)
  const open = resolveModalOpen(options)
  const title = resolveModalTitle(options)
  const onClose = resolveModalOnClose(options)

  document.body.innerHTML = '<div id="root"></div>'
  const target = document.body.querySelector<HTMLElement>('#root')!
  const component = mount(Modal, {
    target,
    props: {
      open,
      title,
      onClose,
      size: options.size,
      body: textSnippet('Modal Content'),
      footer: options.footer,
    },
  })
  return { target, component }
}

describe('Modal.svelte', () => {
  test('renders title and content when open', () => {
    let closed = false
    const { target, component } = renderModal({
      ...defaultRenderModalOptions(),
      onClose: () => {
        closed = true
      },
    })

    expect(target.innerHTML).toContain('Test Modal')
    expect(target.innerHTML).toContain('Modal Content')
    expect(closed).toBe(false)
    void unmount(component)
  })

  test('when open is false, nothing is rendered', () => {
    let closed = false
    const { target, component } = renderModal({
      ...defaultRenderModalOptions(),
      open: false,
      onClose: () => {
        closed = true
      },
    })

    expect(target.querySelector('.modal')).toBeNull()
    expect(target.textContent).toBe('')
    expect(closed).toBe(false)
    void unmount(component)
  })

  test('pressing Escape closes the modal', () => {
    let closed = false
    const { component } = renderModal({
      ...defaultRenderModalOptions(),
      onClose: () => {
        closed = true
      },
    })

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(closed).toBe(true)
    void unmount(component)
  })

  test('clicking backdrop triggers onClose', () => {
    let closed = false
    const { target, component } = renderModal({
      ...defaultRenderModalOptions(),
      onClose: () => {
        closed = true
      },
    })

    const backdrop = target.querySelector('.modal')
    expect(backdrop).not.toBeNull()
    backdrop!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(closed).toBe(true)
    void unmount(component)
  })

  test('clicking modal-content does not trigger onClose', () => {
    let closed = false
    const { target, component } = renderModal({
      ...defaultRenderModalOptions(),
      onClose: () => {
        closed = true
      },
    })

    const modalContent = target.querySelector('.modal-content')
    expect(modalContent).not.toBeNull()
    modalContent!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(closed).toBe(false)
    void unmount(component)
  })

  test.each<ModalSize>(['sm', 'md', 'lg', 'xl'])('renders the %s size class', (size) => {
    const { target, component } = renderModal({ ...defaultRenderModalOptions(), size })

    expect(target.querySelector(`.modal-content.modal--${size}`)).not.toBeNull()
    void unmount(component)
  })

  test('keeps the legacy modal width when size is omitted', () => {
    const { target, component } = renderModal(defaultRenderModalOptions())

    const modalContent = target.querySelector('.modal-content')
    expect(modalContent).not.toBeNull()
    expect(modalContent!.classList.contains('modal--sm')).toBe(false)
    expect(modalContent!.classList.contains('modal--md')).toBe(false)
    expect(modalContent!.classList.contains('modal--lg')).toBe(false)
    expect(modalContent!.classList.contains('modal--xl')).toBe(false)
    void unmount(component)
  })

  test('renders footer content when provided', () => {
    const { target, component } = renderModal({
      ...defaultRenderModalOptions(),
      footer: textSnippet('Modal Footer'),
    })

    expect(target.querySelector('.modal-footer')).not.toBeNull()
    expect(target.textContent).toContain('Modal Footer')
    void unmount(component)
  })
})
