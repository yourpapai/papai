// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import SubjectsTable from '../../../../client/admin/components/SubjectsTable.svelte'
import type { BillingSubject } from '../../../../client/shared/api-types'

function subject(over: Partial<BillingSubject> = {}): BillingSubject {
  return {
    storageContextId: 'ctx-1',
    displayName: 'трясина-рутина',
    contextType: 'group',
    totals: {
      main: { inputTokens: 301998, outputTokens: 1801, calls: 42 },
      small: { inputTokens: 0, outputTokens: 0, calls: 0 },
      embedding: { inputTokens: 12000, outputTokens: 0, calls: 5 },
    },
    toolCalls: 385,
    lastActiveAt: Date.parse('2026-05-21T20:42:00Z'),
    ...over,
  } as BillingSubject
}

describe('SubjectsTable.svelte', () => {
  test('renders numeric token totals with thousands separators, right-aligned', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(SubjectsTable, { target, props: { subjects: [subject()], onSelect: () => {} } })
    expect(target.textContent).toContain('301,998')
    expect(target.querySelector('.ui-datatable__td--right')).not.toBeNull()
    void unmount(c)
  })

  test('renders the context type as a StatusPill', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const c = mount(SubjectsTable, { target, props: { subjects: [subject()], onSelect: () => {} } })
    expect(target.querySelector('.ui-pill')).not.toBeNull()
    void unmount(c)
  })

  test('fires onSelect with the original subject when a row is clicked', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const target = document.body.querySelector<HTMLElement>('#root')!
    const picked: BillingSubject[] = []
    const c = mount(SubjectsTable, {
      target,
      props: {
        subjects: [subject()],
        onSelect: (s: BillingSubject) => {
          picked.push(s)
        },
      },
    })
    target.querySelector<HTMLElement>('.ui-datatable__tr')!.click()
    expect(picked).toHaveLength(1)
    expect(picked[0]?.storageContextId).toBe('ctx-1')
    void unmount(c)
  })
})
