// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import ScopeFilter from '../../../../client/debug/components/ScopeFilter.svelte'

describe('ScopeFilter', () => {
  test('cycling a scope emits include then exclude then clear', () => {
    const scopes = [{ scope: 'chat:telegram', count: 2 }]
    const states: Array<{ include: string[]; exclude: string[] }> = []
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!

    // State 0: neutral — click → include
    let currentInclude: string[] = []
    let currentExclude: string[] = []
    const onChange = (inc: string[], exc: string[]): void => {
      states.push({ include: inc, exclude: exc })
      currentInclude = inc
      currentExclude = exc
    }

    let c = mount(ScopeFilter, {
      target,
      props: { scopes, include: currentInclude, exclude: currentExclude, onChange },
    })
    const chip = (): HTMLElement => target.querySelector<HTMLElement>('button')!
    chip().click()
    void unmount(c)

    // State 1: include → click → exclude
    c = mount(ScopeFilter, {
      target,
      props: { scopes, include: currentInclude, exclude: currentExclude, onChange },
    })
    chip().click()
    void unmount(c)

    // State 2: exclude → click → neutral (clear)
    c = mount(ScopeFilter, {
      target,
      props: { scopes, include: currentInclude, exclude: currentExclude, onChange },
    })
    chip().click()
    void unmount(c)

    expect(states[0]).toEqual({ include: ['chat:telegram'], exclude: [] })
    expect(states[1]).toEqual({ include: [], exclude: ['chat:telegram'] })
    expect(states[2]).toEqual({ include: [], exclude: [] })
  })

  test('renders chips for each scope with count', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const scopes = [
      { scope: 'bot', count: 5 },
      { scope: 'llm', count: 3 },
    ]
    const c = mount(ScopeFilter, {
      target,
      props: { scopes, include: [], exclude: [], onChange: () => {} },
    })
    const buttons = target.querySelectorAll('button')
    expect(buttons.length).toBe(2)
    expect(target.textContent).toContain('bot')
    expect(target.textContent).toContain('llm')
    void unmount(c)
  })
})
