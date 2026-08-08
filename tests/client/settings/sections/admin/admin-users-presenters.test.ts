// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  describeAddedBy,
  removeUserLabel,
  userStatus,
} from '../../../../../client/settings/sections/admin/admin-users-presenters.js'

describe('userStatus', () => {
  test('a blocked user is blocked even when pending', () => {
    expect(userStatus({ userId: 'placeholder-@bob', blocked: true })).toBe('blocked')
  })

  test('a placeholder id is pending', () => {
    expect(userStatus({ userId: 'placeholder-@bob', blocked: false })).toBe('pending')
  })

  test('a real id is active', () => {
    expect(userStatus({ userId: '123456789', blocked: false })).toBe('active')
  })
})

describe('describeAddedBy', () => {
  test('open-access reads as a label', () => {
    expect(describeAddedBy('open-access')).toEqual({ kind: 'label', text: 'Open access' })
  })

  test('announce-subscription reads as a label', () => {
    expect(describeAddedBy('announce-subscription')).toEqual({ kind: 'label', text: 'Announcement signup' })
  })

  test('any other value is an admin id', () => {
    expect(describeAddedBy('555000111')).toEqual({ kind: 'id', value: '555000111' })
  })

  test('an empty value has nothing to show', () => {
    expect(describeAddedBy('')).toEqual({ kind: 'none' })
  })
})

describe('removeUserLabel', () => {
  test('names an active user and their id', () => {
    expect(removeUserLabel({ username: 'alice_tg', userId: '123456789' })).toBe('alice_tg (123456789)')
  })

  test('names a pending user without exposing the placeholder id', () => {
    expect(removeUserLabel({ username: '@bob_handle', userId: 'placeholder-@bob_handle' })).toBe(
      '@bob_handle (pending)',
    )
  })

  test('falls back to the id when there is no username', () => {
    expect(removeUserLabel({ username: '—', userId: '123456789' })).toBe('123456789')
  })

  test('falls back to a description when there is neither', () => {
    expect(removeUserLabel({ username: '', userId: 'placeholder-x' })).toBe('this pending user')
  })
})
