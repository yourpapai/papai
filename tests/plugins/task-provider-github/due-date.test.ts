// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  normalizeGitHubDueDateInput,
  normalizeGitHubListTaskParams,
} from '../../../plugins/task-provider-github/due-date.js'

describe('GitHub due-date normalizers (no-ops)', () => {
  describe('normalizeGitHubDueDateInput', () => {
    test('returns undefined when undefined', () => {
      expect(normalizeGitHubDueDateInput(undefined)).toBeUndefined()
    })

    test('returns undefined regardless of the input shape (GitHub has no due dates)', () => {
      expect(normalizeGitHubDueDateInput({ date: '2024-03-15', time: '14:30' })).toBeUndefined()
    })
  })

  describe('normalizeGitHubListTaskParams', () => {
    test('passes params through unchanged', () => {
      const params = { status: 'open', priority: 'high', dueBefore: '2026-01-01T10:00:00Z', limit: 10 }
      expect(normalizeGitHubListTaskParams(params)).toEqual(params)
    })

    test('returns an equal object for empty params', () => {
      expect(normalizeGitHubListTaskParams({})).toEqual({})
    })
  })
})
