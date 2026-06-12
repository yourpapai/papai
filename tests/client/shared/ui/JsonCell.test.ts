// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import JsonCell from '../../../../client/shared/ui/JsonCell.svelte'

describe('JsonCell.svelte', () => {
  test('renders one chip per key for a JSON object string', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(JsonCell, {
      target,
      props: { value: '{"baseUrl":"https://kaneo.drowbridge.uk","internalUrl":"http://kaneo:5173"}' },
    })
    expect(target.querySelectorAll('.ui-jsoncell__chip').length).toBe(2)
    expect(target.textContent).toContain('baseUrl')
    expect(target.textContent).toContain('https://kaneo.drowbridge.uk')
    void unmount(c)
  })
  test('falls back to a Code chip for non-object strings', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(JsonCell, { target, props: { value: 'not json' } })
    expect(target.querySelector('.ui-jsoncell__chip')).toBeNull()
    expect(target.querySelector('.ui-code')?.textContent).toContain('not json')
    void unmount(c)
  })
  test('accepts an object value directly', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(JsonCell, { target, props: { value: { a: 1, b: 'two' } } })
    expect(target.querySelectorAll('.ui-jsoncell__chip').length).toBe(2)
    void unmount(c)
  })
})
