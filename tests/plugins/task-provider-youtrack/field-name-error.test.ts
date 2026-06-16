// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { unknownFieldError } from '../../../plugins/task-provider-youtrack/field-name-error.js'

describe('unknownFieldError', () => {
  test('lists available field names in message and details', () => {
    const error = unknownFieldError('URL адеса', ['Cтaтус', 'Срочность'], 'create')
    expect(error.message).toContain('URL адеса')
    expect(error.message).toContain('Cтaтус')
    expect(error.message).toContain('Срочность')
    expect(error.message).toContain('create')
    expect(error.appError.code).toBe('validation-failed')
    expect(error.appError).toHaveProperty('field', 'customFields')
    expect(error.appError).toHaveProperty('reason', expect.stringContaining('Cтaтус'))
  })

  test('caps the available list at 50 names', () => {
    const names = Array.from({ length: 60 }, (_, i) => `Field${i}`)
    const error = unknownFieldError('X', names, 'update')
    expect(error.message).toContain('and 10 more')
    expect(error.message).toContain('update')
  })
})
