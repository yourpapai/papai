// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { canonicalize, VOLATILE, VOLATILE_KEYS } from './canonicalize.js'

describe('canonicalize', () => {
  test('blanks volatile string ids and timestamps but keeps stable fields', () => {
    const input = {
      id: 'abc-123',
      title: 'Task',
      status: 'todo',
      createdAt: '2026-01-01T00:00:00Z',
    }
    expect(canonicalize(input, VOLATILE_KEYS)).toEqual({
      id: VOLATILE,
      title: 'Task',
      status: 'todo',
      createdAt: VOLATILE,
    })
  })

  test('preserves array order so sort semantics stay observable', () => {
    const input = [
      { id: 'z', title: 'A' },
      { id: 'a', title: 'B' },
    ]
    expect(canonicalize(input, VOLATILE_KEYS)).toEqual([
      { id: VOLATILE, title: 'A' },
      { id: VOLATILE, title: 'B' },
    ])
  })

  test('recurses into nested objects and arrays', () => {
    const input = { projectId: 'p1', labels: [{ labelId: 'l1', name: 'bug' }] }
    expect(canonicalize(input, VOLATILE_KEYS)).toEqual({
      projectId: VOLATILE,
      labels: [{ labelId: VOLATILE, name: 'bug' }],
    })
  })

  test('throws when a declared volatile field is absent-shaped (null) so drift is caught', () => {
    expect(() => canonicalize({ id: null, title: 'x' }, VOLATILE_KEYS)).toThrow()
  })

  test('leaves a volatile-named field untouched when the value is a non-empty number', () => {
    expect(canonicalize({ id: 7, title: 'x' }, VOLATILE_KEYS)).toEqual({
      id: VOLATILE,
      title: 'x',
    })
  })
})
