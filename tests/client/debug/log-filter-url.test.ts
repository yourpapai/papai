// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { emptyFilter, filterFromParams, filterToParams, filterToQuery } from '../../../client/debug/log-filter-url.js'

describe('log-filter-url', () => {
  test('emptyFilter is pass-all', () => {
    expect(emptyFilter()).toEqual({ include: [], exclude: [], level: 0 })
  })

  test('filterToParams emits repeated include/exclude and skips defaults', () => {
    const p = filterToParams({ include: ['chat', 'tool'], exclude: ['chat:telegram:*'], level: 30, q: 'x' })
    expect(p.getAll('include')).toEqual(['chat', 'tool'])
    expect(p.getAll('exclude')).toEqual(['chat:telegram:*'])
    expect(p.get('level')).toBe('30')
    expect(p.get('q')).toBe('x')
  })

  test('level 0 and empty q are omitted', () => {
    const p = filterToParams({ include: [], exclude: [], level: 0 })
    expect(p.has('level')).toBe(false)
    expect(p.has('q')).toBe(false)
  })

  test('round-trips through params', () => {
    const f = { include: ['chat'], exclude: ['tool:x'], level: 40, turnId: 't1', q: 'boom' }
    expect(filterFromParams(new URLSearchParams(filterToQuery(f)))).toEqual(f)
  })
})
