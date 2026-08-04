// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  UNASSIGNED_PLACEHOLDER,
  UNAVAILABLE_PLACEHOLDER,
  resolveTaskInstanceSelection,
} from '../../../../client/settings/lib/task-instance-selection.js'

const available = [{ id: 'inst_a' }, { id: 'inst_b' }]

describe('resolveTaskInstanceSelection', () => {
  test('selects the bound instance with no placeholder', () => {
    expect(resolveTaskInstanceSelection('inst_b', available)).toEqual({ selected: 'inst_b', placeholder: '' })
  })

  test('selects nothing when no instance is bound, rather than the first available', () => {
    const result = resolveTaskInstanceSelection(null, available)
    expect(result.selected).toBe('')
    expect(result.selected).not.toBe('inst_a')
    expect(result.placeholder).toBe(UNASSIGNED_PLACEHOLDER)
  })

  test('selects nothing when the bound instance is missing from the available list', () => {
    const result = resolveTaskInstanceSelection('gone', available)
    expect(result.selected).toBe('')
    expect(result.selected).not.toBe('inst_a')
    expect(result.placeholder).toBe(UNAVAILABLE_PLACEHOLDER)
  })

  test('selects nothing when there are no instances at all', () => {
    expect(resolveTaskInstanceSelection(null, [])).toEqual({ selected: '', placeholder: UNASSIGNED_PLACEHOLDER })
  })

  test('distinguishes the unbound and stale placeholders', () => {
    expect(UNASSIGNED_PLACEHOLDER).not.toBe(UNAVAILABLE_PLACEHOLDER)
  })
})
