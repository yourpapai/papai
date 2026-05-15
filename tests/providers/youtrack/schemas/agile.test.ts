// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { AgileSchema, AgileWithSprintsSchema } from '../../../../src/providers/youtrack/schemas/agile.js'

describe('AgileSchema', () => {
  test('parses valid agile', () => {
    const data = { id: 'agile-1', name: 'My Board' }

    expect(AgileSchema.parse(data)).toEqual({ id: 'agile-1', name: 'My Board' })
  })

  test('rejects missing id', () => {
    expect(() => AgileSchema.parse({ name: 'Board' })).toThrow()
  })
})

describe('AgileWithSprintsSchema', () => {
  test('parses agile with sprint ids', () => {
    const data = {
      id: 'agile-1',
      sprints: [{ id: 'sprint-1' }, { id: 'sprint-2' }],
    }

    expect(AgileWithSprintsSchema.parse(data)).toEqual(data)
  })

  test('accepts missing sprints', () => {
    expect(AgileWithSprintsSchema.parse({ id: 'agile-1' })).toEqual({ id: 'agile-1' })
  })
})
