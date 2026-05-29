// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  mapYouTrackDueDateValue,
  normalizeYouTrackDueDateInput,
  normalizeYouTrackListTaskParams,
  parseDueDateValue,
} from '../../../plugins/task-provider-youtrack/due-date.js'

describe('YouTrack due-date helpers', () => {
  describe('normalizeYouTrackDueDateInput', () => {
    test('returns date-only', () => {
      const result = normalizeYouTrackDueDateInput({ date: '2024-03-15', time: '14:30' })
      expect(result).toBe('2024-03-15')
    })

    test('returns undefined when undefined', () => {
      const result = normalizeYouTrackDueDateInput(undefined)
      expect(result).toBeUndefined()
    })
  })

  describe('mapYouTrackDueDateValue', () => {
    test('maps timestamp to date-only string', () => {
      const result = mapYouTrackDueDateValue(Date.parse('2024-03-15T12:00:00.000Z'))
      expect(result).toBe('2024-03-15')
    })
  })

  describe('parseDueDateValue', () => {
    test('accepts date-only values', () => {
      const result = parseDueDateValue('2024-03-15')
      expect(new Date(result).toISOString()).toBe('2024-03-15T12:00:00.000Z')
    })

    test('accepts ISO datetime values and normalizes to the same calendar date', () => {
      const result = parseDueDateValue('2024-03-15T23:45:00+02:00')
      expect(new Date(result).toISOString()).toBe('2024-03-15T12:00:00.000Z')
    })
  })

  describe('normalizeYouTrackListTaskParams', () => {
    test('normalizes datetime filters', () => {
      const result = normalizeYouTrackListTaskParams({
        dueAfter: '2024-03-15T14:30:00Z',
        dueBefore: '2024-03-20',
      })
      expect(result.dueAfter).toBe('2024-03-15')
      expect(result.dueBefore).toBe('2024-03-20')
    })
  })
})
