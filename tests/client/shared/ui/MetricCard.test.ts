// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import MetricCard from '../../../../client/shared/ui/MetricCard.svelte'

describe('MetricCard.svelte', () => {
  test('renders label and value', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(MetricCard, {
      target,
      props: { label: 'subjects', value: 36 },
    })
    expect(target.textContent).toContain('subjects')
    expect(target.textContent).toContain('36')
    void unmount(component)
  })

  test('renders sub line when provided', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(MetricCard, {
      target,
      props: { label: 'tokens', value: '2.41M', sub: '1.92M in · 487K out' },
    })
    expect(target.textContent).toContain('1.92M in')
    expect(target.textContent).toContain('487K out')
    void unmount(component)
  })

  test('omits sub line when undefined', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(MetricCard, {
      target,
      props: { label: 'llm calls', value: 1089 },
    })
    expect(target.querySelector('.ui-metric-card__sub')).toBeNull()
    void unmount(component)
  })

  test('applies accent color to value when provided', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const component = mount(MetricCard, {
      target,
      props: { label: 'live', value: 4, accent: 'var(--accent)' },
    })
    const value = target.querySelector<HTMLElement>('.ui-metric-card__value')
    expect(value?.style.color).toBe('var(--accent)')
    void unmount(component)
  })
})
