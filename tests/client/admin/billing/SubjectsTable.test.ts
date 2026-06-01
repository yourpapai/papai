// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mount, unmount } from 'svelte'

import SubjectsTable from '../../../../client/admin/components/SubjectsTable.svelte'
import type { BillingSubject } from '../../../../client/shared/api-types.js'

const emptyTotals = { inputTokens: 0, outputTokens: 0, calls: 0 }

const makeSubject = (overrides: Partial<BillingSubject>): BillingSubject => ({
  storageContextId: 'user-A',
  contextType: 'dm',
  displayName: 'alice',
  totals: {
    main: { inputTokens: 10, outputTokens: 20, calls: 1 },
    small: emptyTotals,
    embedding: { inputTokens: 5, outputTokens: 0, calls: 1 },
  },
  toolCalls: 0,
  lastActiveAt: 1_700_000_000_000,
  ...overrides,
})

type Mounted = {
  target: HTMLElement
  component: ReturnType<typeof mount>
  selected: BillingSubject[]
}

const render = (subjects: BillingSubject[]): Mounted => {
  document.body.innerHTML = '<div id="root"></div>'
  const target = document.querySelector<HTMLElement>('#root')
  if (target === null) throw new Error('root missing')
  const selected: BillingSubject[] = []
  const component = mount(SubjectsTable, {
    target,
    props: {
      subjects,
      onSelect: (s: BillingSubject) => {
        selected.push(s)
      },
    },
  })
  return { target, component, selected }
}

describe('admin SubjectsTable', () => {
  test('shows empty-state text when subjects is empty', () => {
    const { target, component } = render([])
    expect(target.textContent).toContain('No usage')
    void unmount(component)
  })

  test('renders one row per subject with display name', () => {
    const { target, component } = render([
      makeSubject({}),
      makeSubject({ storageContextId: 'user-B', displayName: 'bob' }),
    ])
    const text = target.textContent
    expect(text).toContain('alice')
    expect(text).toContain('bob')
    void unmount(component)
  })

  test('falls back to the raw id when displayName is null', () => {
    const { target, component } = render([makeSubject({ displayName: null })])
    expect(target.textContent).toContain('user-A')
    void unmount(component)
  })

  test('calling onSelect when a row is clicked', () => {
    const subject = makeSubject({})
    const { target, component, selected } = render([subject])
    const row = target.querySelector<HTMLElement>('.ui-datatable__tr')
    expect(row).not.toBeNull()
    row!.click()
    expect(selected).toHaveLength(1)
    const selectedSubject = selected[0]!
    expect(selectedSubject.storageContextId).toBe('user-A')
    void unmount(component)
  })
})
