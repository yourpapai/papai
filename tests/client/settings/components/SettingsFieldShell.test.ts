// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { createRawSnippet, flushSync, mount, unmount } from 'svelte'

import SettingsFieldShell from '../../../../client/settings/components/SettingsFieldShell.svelte'
import ShellInputFixture from './ShellInputFixture.svelte'

const render = (props: Record<string, unknown>): { component: ReturnType<typeof mount>; target: HTMLElement } => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')!
  return { component: mount(SettingsFieldShell, { target, props }), target }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('SettingsFieldShell', () => {
  test('renders the label text and the card testid', () => {
    const { component, target } = render({ label: 'Anthropic API Key', testid: 'byok-row-x' })
    flushSync()
    expect(target.querySelector('[data-testid="byok-row-x"]')).not.toBeNull()
    expect(target.querySelector('.settings-field__label')!.textContent).toContain('Anthropic API Key')
    void unmount(component)
  })

  test('renders an accent-colored required marker only when required', () => {
    const { component, target } = render({ label: 'Key', required: true })
    flushSync()
    const req = target.querySelector('.settings-field__req')
    expect(req).not.toBeNull()
    expect(req!.textContent).toBe('*')
    expect(target.querySelector('.settings-field__label')!.textContent).toContain('*')
    void unmount(component)
  })

  test('omits the required marker when not required', () => {
    const { component, target } = render({ label: 'Key', required: false })
    flushSync()
    expect(target.querySelector('.settings-field__req')).toBeNull()
    expect(target.querySelector('.settings-field__label')!.textContent).not.toContain('*')
    void unmount(component)
  })

  test('does not render an editor wrapper when no editor snippet is provided', () => {
    const { component, target } = render({ label: 'Key' })
    flushSync()
    expect(target.querySelector('.settings-field__editor')).toBeNull()
    void unmount(component)
  })

  test('renders the editor snippet inside .settings-field__editor when editorOpen defaults to true', () => {
    const editor = createRawSnippet(() => ({ render: (): string => `<span data-testid="ed">E</span>` }))
    const { component, target } = render({ label: 'Key', editor })
    flushSync()
    const wrap = target.querySelector('.settings-field__editor')
    expect(wrap).not.toBeNull()
    expect(wrap!.querySelector('[data-testid="ed"]')).not.toBeNull()
    void unmount(component)
  })

  test('does not render the editor snippet when editorOpen is false', () => {
    const editor = createRawSnippet(() => ({ render: (): string => `<span data-testid="ed">E</span>` }))
    const { component, target } = render({ label: 'Key', editor, editorOpen: false })
    flushSync()
    expect(target.querySelector('.settings-field__editor')).toBeNull()
    expect(target.querySelector('[data-testid="ed"]')).toBeNull()
    void unmount(component)
  })

  test('renders head and footer snippets in their slots', () => {
    const head = createRawSnippet(() => ({ render: (): string => `<span data-testid="hd">H</span>` }))
    const footer = createRawSnippet(() => ({ render: (): string => `<span data-testid="ft">F</span>` }))
    const { component, target } = render({ label: 'Key', head, footer })
    flushSync()
    expect(target.querySelector('.settings-field__head [data-testid="hd"]')).not.toBeNull()
    expect(target.querySelector('[data-testid="ft"]')).not.toBeNull()
    void unmount(component)
  })

  test('renders the error with role=alert when error is set', () => {
    const { component, target } = render({ label: 'Instance URL', error: 'must start with https://' })
    flushSync()
    const el = target.querySelector<HTMLElement>('.settings-field__error')!
    expect(el.textContent).toContain('must start with https://')
    expect(el.getAttribute('role')).toBe('alert')
    void unmount(component)
  })

  test('renders the hint when there is no error', () => {
    const { component, target } = render({ label: 'Model', hint: 'Leave blank for the agent default.' })
    flushSync()
    expect(target.querySelector('.settings-field__hint')!.textContent).toContain('Leave blank')
    expect(target.querySelector('.settings-field__error')).toBeNull()
    void unmount(component)
  })

  test('error wins over hint when both are supplied', () => {
    const { component, target } = render({ label: 'Model', hint: 'a hint', error: 'too long (max 200 characters)' })
    flushSync()
    expect(target.querySelector('.settings-field__error')!.textContent).toContain('too long')
    expect(target.querySelector('.settings-field__hint')).toBeNull()
    void unmount(component)
  })

  test('publishes the error to an Input in the editor snippet', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ShellInputFixture, { target, props: { error: 'must start with https://' } })
    flushSync()
    const input = target.querySelector<HTMLInputElement>('[data-testid="fixture-input"]')!
    const err = target.querySelector<HTMLElement>('.settings-field__error')!
    expect(err.id).toBeTruthy()
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input.getAttribute('aria-describedby')).toBe(err.id)
    void unmount(component)
  })

  test('leaves an Input valid when the shell has no error', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.querySelector<HTMLElement>('#root')!
    const component = mount(ShellInputFixture, { target, props: {} })
    flushSync()
    const input = target.querySelector<HTMLInputElement>('[data-testid="fixture-input"]')!
    expect(input.getAttribute('aria-invalid')).toBeNull()
    expect(input.getAttribute('aria-describedby')).toBeNull()
    void unmount(component)
  })

  // Emptiness is expressed two ways in the component: the markup guards the error <p> with a
  // falsy `{#if error}`, while the field-error context checks `error !== undefined && error !== ''`
  // explicitly. An empty string is the one input where those two spellings could diverge, so pin
  // that both treat it as "no error" -- otherwise a stray '' would announce an empty role=alert.
  test('treats an empty error string as no error, in both the markup and the context', () => {
    const { component, target } = render({ label: 'Model', hint: 'a hint', error: '' })
    flushSync()
    expect(target.querySelector('.settings-field__error')).toBeNull()
    expect(target.querySelector('.settings-field__hint')!.textContent).toContain('a hint')
    void unmount(component)

    document.body.innerHTML = '<div id="root"></div>'
    const fixtureTarget = document.querySelector<HTMLElement>('#root')!
    const fixture = mount(ShellInputFixture, { target: fixtureTarget, props: { error: '' } })
    flushSync()
    const input = fixtureTarget.querySelector<HTMLInputElement>('[data-testid="fixture-input"]')!
    expect(input.getAttribute('aria-invalid')).toBeNull()
    expect(input.getAttribute('aria-describedby')).toBeNull()
    void unmount(fixture)
  })

  test('points aria-describedby at the hint paragraph when the shell is valid', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(ShellInputFixture, { target, props: { hint: 'Needed for self-hosted hosts.' } })
    const input = target.querySelector<HTMLInputElement>('[data-testid="fixture-input"]')!
    const hint = target.querySelector<HTMLElement>('.settings-field__hint')!
    expect(hint.id).toBeTruthy()
    expect(hint.textContent).toContain('Needed for self-hosted hosts.')
    expect(input.getAttribute('aria-describedby')).toBe(hint.id)
    void unmount(c)
  })

  test('sets aria-required on the editor control and hides the required glyph', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(ShellInputFixture, { target, props: { required: true } })
    const input = target.querySelector<HTMLInputElement>('[data-testid="fixture-input"]')!
    expect(input.getAttribute('aria-required')).toBe('true')
    expect(target.querySelector('.settings-field__req')!.getAttribute('aria-hidden')).toBe('true')
    void unmount(c)
  })
})
