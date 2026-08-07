// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { validateInstanceCreate } from '../../../../../client/settings/sections/admin/instance-create.js'

describe('validateInstanceCreate', () => {
  test('a filled, unique id with a type selected is valid', () => {
    expect(validateInstanceCreate({ id: 'tg-eu', type: 'telegram', existingIds: ['tg-main'] })).toEqual({})
  })

  test('a blank id is required', () => {
    expect(validateInstanceCreate({ id: '', type: 'telegram', existingIds: [] })).toEqual({ id: 'Required' })
  })

  test('a whitespace-only id counts as blank', () => {
    expect(validateInstanceCreate({ id: '   ', type: 'telegram', existingIds: [] })).toEqual({ id: 'Required' })
  })

  test('an id already in use is rejected', () => {
    expect(validateInstanceCreate({ id: 'tg-main', type: 'telegram', existingIds: ['tg-main'] })).toEqual({
      id: 'An instance with this id already exists',
    })
  })

  test('the duplicate check compares trimmed ids', () => {
    expect(validateInstanceCreate({ id: '  tg-main  ', type: 'telegram', existingIds: ['tg-main'] })).toEqual({
      id: 'An instance with this id already exists',
    })
  })

  test('a missing type is required', () => {
    expect(validateInstanceCreate({ id: 'tg-eu', type: '', existingIds: [] })).toEqual({ type: 'Required' })
  })

  test('both fields can fail at once', () => {
    expect(validateInstanceCreate({ id: '', type: '', existingIds: [] })).toEqual({
      id: 'Required',
      type: 'Required',
    })
  })
})
