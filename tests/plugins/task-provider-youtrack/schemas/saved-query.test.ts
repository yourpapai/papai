// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { SavedQuerySchema } from '../../../../plugins/task-provider-youtrack/schemas/saved-query.js'

describe('SavedQuerySchema', () => {
  test('parses valid saved query', () => {
    const data = { id: 'query-1', name: 'Open Issues', query: 'State: Open' }

    expect(SavedQuerySchema.parse(data)).toEqual(data)
  })

  test('accepts missing query', () => {
    expect(SavedQuerySchema.parse({ id: 'query-1', name: 'Open Issues' })).toEqual({
      id: 'query-1',
      name: 'Open Issues',
    })
  })

  test('rejects missing name', () => {
    expect(() => SavedQuerySchema.parse({ id: 'query-1' })).toThrow()
  })
})
