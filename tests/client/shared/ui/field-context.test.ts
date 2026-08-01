// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { flushSync, mount, unmount } from 'svelte'

import { getFieldLabelId } from '../../../../client/shared/ui/field-context.js'
import Select from '../../../../client/shared/ui/Select.svelte'
import { requiredHarnessState } from './field-required-harness.svelte.js'
import FieldHintFixture from './FieldHintFixture.svelte'
import FieldRequiredRaceFixture from './FieldRequiredRaceFixture.svelte'
import FieldSelectFixture from './FieldSelectFixture.svelte'

describe('field-context', () => {
  test('getFieldLabelId throws when called outside component initialization', () => {
    expect(() => getFieldLabelId()).toThrow()
  })

  test('publishes the Field label id to a nested Select via context', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(FieldSelectFixture, { target, props: {} })
    const label = target.querySelector<HTMLElement>('.ui-field__label')!
    const select = target.querySelector<HTMLSelectElement>('[data-testid="fixture-select"]')!
    expect(label.id).toBeTruthy()
    expect(select.getAttribute('aria-labelledby')).toBe(label.id)
    void unmount(c)
  })

  test('leaves aria-labelledby unset on a standalone Select outside a Field', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(Select, { target, props: { value: 'a', options: [{ value: 'a', label: 'A' }] } })
    const select = target.querySelector<HTMLSelectElement>('select')!
    expect(select.getAttribute('aria-labelledby')).toBeNull()
    void unmount(c)
  })

  test('points aria-describedby at the hint when the field is valid', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(FieldHintFixture, { target, props: { hint: 'https only' } })
    const input = target.querySelector<HTMLInputElement>('[data-testid="hint-input"]')!
    const hint = target.querySelector<HTMLElement>('.ui-field__hint')!
    expect(hint.id).toBeTruthy()
    expect(hint.textContent).toContain('https only')
    expect(input.getAttribute('aria-describedby')).toBe(hint.id)
    void unmount(c)
  })

  test('points aria-describedby at the error when both an error and a hint are set', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(FieldHintFixture, { target, props: { hint: 'https only', error: 'not reachable' } })
    const input = target.querySelector<HTMLInputElement>('[data-testid="hint-input"]')!
    const err = target.querySelector<HTMLElement>('.ui-field__error')!
    expect(target.querySelector('.ui-field__hint')).toBeNull()
    expect(input.getAttribute('aria-describedby')).toBe(err.id)
    void unmount(c)
  })

  test('omits aria-describedby when the field has neither hint nor error', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(FieldHintFixture, { target, props: {} })
    const input = target.querySelector<HTMLInputElement>('[data-testid="hint-input"]')!
    expect(input.getAttribute('aria-describedby')).toBeNull()
    void unmount(c)
  })

  test('sets aria-required on the control when the Field is required', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(FieldHintFixture, { target, props: { required: true } })
    const input = target.querySelector<HTMLInputElement>('[data-testid="hint-input"]')!
    expect(input.getAttribute('aria-required')).toBe('true')
    void unmount(c)
  })

  test('omits aria-required when the Field is optional', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(FieldHintFixture, { target, props: {} })
    const input = target.querySelector<HTMLInputElement>('[data-testid="hint-input"]')!
    expect(input.getAttribute('aria-required')).toBeNull()
    void unmount(c)
  })

  test('hides the required glyph from the accessibility tree', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(FieldHintFixture, { target, props: { required: true } })
    expect(target.querySelector('.ui-field__req')!.getAttribute('aria-hidden')).toBe('true')
    void unmount(c)
  })

  // Task 1 left `invalid`/`hasHint` reactivity to structural analogy with no direct proof;
  // this closes that gap for all three getters at once by driving `required` and `hint`
  // through a reactive ($state) prop pair after the Field has already mounted, rather than
  // only ever passing them at mount time.
  test('tracks required and hint props that change after the Field has mounted', () => {
    requiredHarnessState.required = false
    requiredHarnessState.hint = ''
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(FieldRequiredRaceFixture, { target, props: {} })
    const input = target.querySelector<HTMLInputElement>('[data-testid="hint-input"]')!
    expect(input.getAttribute('aria-required')).toBeNull()
    expect(input.getAttribute('aria-describedby')).toBeNull()

    requiredHarnessState.required = true
    requiredHarnessState.hint = 'https only'
    flushSync()

    expect(input.getAttribute('aria-required')).toBe('true')
    const hint = target.querySelector<HTMLElement>('.ui-field__hint')!
    expect(hint.textContent).toContain('https only')
    expect(input.getAttribute('aria-describedby')).toBe(hint.id)

    void unmount(c)
  })
})
