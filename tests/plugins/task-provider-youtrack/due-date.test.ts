// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { YouTrackClassifiedError } from '../../../plugins/task-provider-youtrack/classify-error.js'
import {
  DueDateCustomFieldSchema,
  mapYouTrackDueDateValue,
  normalizeYouTrackDueDateInput,
  normalizeYouTrackListTaskParams,
  parseDueDateValue,
} from '../../../plugins/task-provider-youtrack/due-date.js'

const captureValidationFailure = (fn: () => unknown): { message: string; field: string; reason: string } => {
  try {
    fn()
  } catch (error) {
    if (!(error instanceof YouTrackClassifiedError)) throw error
    const appError = error.appError
    if (appError.code !== 'validation-failed') {
      throw new Error(`expected validation-failed appError, got ${appError.code}`, { cause: error })
    }
    return { message: error.message, field: appError.field, reason: appError.reason }
  }
  throw new Error('expected parseDueDateValue to throw YouTrackClassifiedError')
}

describe('YouTrack due-date helpers', () => {
  describe('DueDateCustomFieldSchema', () => {
    test('rejects an object missing name', () => {
      const result = DueDateCustomFieldSchema.safeParse({})
      expect(result.success).toBe(false)
    })
  })

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

    test('returns undefined for null and undefined', () => {
      expect(mapYouTrackDueDateValue(null)).toBe(undefined)
      expect(mapYouTrackDueDateValue(undefined)).toBe(undefined)
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

    test('rejects input that is neither a calendar date nor an ISO datetime', () => {
      const failure = captureValidationFailure(() => parseDueDateValue('abc2024-03-15'))
      expect(failure.message).toBe('Invalid dueDate: abc2024-03-15')
      expect(failure.field).toBe('dueDate')
      expect(failure.reason).toBe('Expected YYYY-MM-DD or an ISO datetime with timezone information')
    })

    test('rejects an ISO datetime with a non-date prefix', () => {
      const failure = captureValidationFailure(() => parseDueDateValue('abc2024-03-15T23:45:00+02:00'))
      expect(failure.message).toBe('Invalid dueDate: abc2024-03-15T23:45:00+02:00')
      expect(failure.field).toBe('dueDate')
      expect(failure.reason).toBe('Expected YYYY-MM-DD or an ISO datetime with timezone information')
    })

    test('rejects an ISO datetime with a trailing suffix', () => {
      const failure = captureValidationFailure(() => parseDueDateValue('2024-03-15T23:45:00+02:00abc'))
      expect(failure.message).toBe('Invalid dueDate: 2024-03-15T23:45:00+02:00abc')
      expect(failure.field).toBe('dueDate')
      expect(failure.reason).toBe('Expected YYYY-MM-DD or an ISO datetime with timezone information')
    })

    test('accepts an ISO datetime without seconds', () => {
      const result = parseDueDateValue('2024-03-15T23:45+02:00')
      expect(result).toBe(Date.parse('2024-03-15T12:00:00.000Z'))
    })

    test('accepts an ISO datetime with three-digit fractional seconds', () => {
      const result = parseDueDateValue('2024-03-15T23:45:00.123+02:00')
      expect(result).toBe(Date.parse('2024-03-15T12:00:00.000Z'))
    })

    test('rejects a date-shaped but non-calendar value', () => {
      const failure = captureValidationFailure(() => parseDueDateValue('2024-02-30'))
      expect(failure.message).toBe('Invalid dueDate: 2024-02-30')
      expect(failure.field).toBe('dueDate')
      expect(failure.reason).toBe('Expected a real calendar date in YYYY-MM-DD format')
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

    test('leaves undefined filters undefined', () => {
      const result = normalizeYouTrackListTaskParams({})
      expect(result.dueAfter).toBe(undefined)
      expect(result.dueBefore).toBe(undefined)
    })

    test('slices a prefixed filter that is not a clean date', () => {
      const result = normalizeYouTrackListTaskParams({ dueAfter: 'abc2024-03-15' })
      expect(result.dueAfter).toBe('abc2024-03')
    })
  })
})
