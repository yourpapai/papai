// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import { getFieldLabelId } from '../../../../client/shared/ui/field-context.js'
import Select from '../../../../client/shared/ui/Select.svelte'
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
})
