// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import PageHeader from '../../../../client/shared/ui/PageHeader.svelte'

describe('PageHeader.svelte', () => {
  test('renders title and eyebrow without duplicating the title', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(PageHeader, { target, props: { eyebrow: 'runtime', title: 'Instances', sub: 'platform · task' } })
    expect(target.querySelector('.ui-page-header__title')?.textContent).toBe('Instances')
    expect(target.querySelector('.ui-caption')?.textContent).toContain('runtime')
    expect(target.querySelector('.ui-page-header__sub')?.textContent).toContain('platform')
    void unmount(c)
  })
  test('omits eyebrow and sub when not provided', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(PageHeader, { target, props: { title: 'System' } })
    expect(target.querySelector('.ui-caption')).toBeNull()
    expect(target.querySelector('.ui-page-header__sub')).toBeNull()
    void unmount(c)
  })

  test('applies titleTestId to the title element when provided', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(PageHeader, { target, props: { title: 'Instances', titleTestId: 'admin-section-title' } })
    expect(target.querySelector('[data-testid="admin-section-title"]')?.textContent).toBe('Instances')
    void unmount(c)
  })

  test('omits the title data-testid attribute when titleTestId is absent', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(PageHeader, { target, props: { title: 'System' } })
    expect(target.querySelector('[data-testid]')).toBeNull()
    void unmount(c)
  })
})
