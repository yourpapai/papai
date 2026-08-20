// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { markTouched, shownError } from '../../../../client/shared/ui/field-touched.js'

describe('shownError', () => {
  test('hides a message for an untouched field', () => {
    expect(shownError({ id: 'Required.' }, [], 'id')).toBeUndefined()
  })

  test('shows a message once the field is touched', () => {
    expect(shownError({ id: 'Required.' }, ['id'], 'id')).toBe('Required.')
  })

  test('returns undefined when the field has no error', () => {
    expect(shownError({}, ['id'], 'id')).toBeUndefined()
  })

  test('shows an always-show message even when untouched', () => {
    const alwaysShow = (m: string): boolean => m === 'That ID is already in use.'
    expect(shownError({ id: 'That ID is already in use.' }, [], 'id', alwaysShow)).toBe('That ID is already in use.')
  })

  test('still gates a non-matching message when an always-show predicate is given', () => {
    const alwaysShow = (m: string): boolean => m === 'That ID is already in use.'
    expect(shownError({ id: 'Required.' }, [], 'id', alwaysShow)).toBeUndefined()
  })
})

describe('markTouched', () => {
  test('appends a field that is not yet touched', () => {
    expect(markTouched([], 'id')).toEqual(['id'])
  })

  test('returns the same array reference when already touched', () => {
    const touched = ['id']
    expect(markTouched(touched, 'id')).toBe(touched)
  })

  test('does not mutate the input array', () => {
    const touched: string[] = []
    markTouched(touched, 'id')
    expect(touched).toEqual([])
  })
})
