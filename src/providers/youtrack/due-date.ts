// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { providerError } from '../../errors.js'
import type { ListTasksParams } from '../types.js'
import { YouTrackClassifiedError } from './classify-error.js'

export const DueDateCustomFieldSchema = z.object({ name: z.string(), value: z.unknown().optional() })

const isDateOnlyValue = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value)

const isIsoDateTimeValue = (value: string): boolean =>
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)

const isValidDateOnlyValue = (value: string): boolean => {
  if (!isDateOnlyValue(value)) return false
  const parsed = new Date(`${value}T12:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export const parseDueDateValue = (dueDate: string): number => {
  if (isValidDateOnlyValue(dueDate)) {
    return Date.parse(`${dueDate}T12:00:00.000Z`)
  }

  if (isDateOnlyValue(dueDate)) {
    throw new YouTrackClassifiedError(
      `Invalid dueDate: ${dueDate}`,
      providerError.validationFailed('dueDate', 'Expected a real calendar date in YYYY-MM-DD format'),
    )
  }

  if (isIsoDateTimeValue(dueDate)) {
    return Date.parse(`${dueDate.slice(0, 10)}T12:00:00.000Z`)
  }

  throw new YouTrackClassifiedError(
    `Invalid dueDate: ${dueDate}`,
    providerError.validationFailed('dueDate', 'Expected YYYY-MM-DD or an ISO datetime with timezone information'),
  )
}

export const mapYouTrackDueDateValue = (timestamp: number | null | undefined): string | undefined =>
  timestamp === undefined || timestamp === null ? undefined : new Date(timestamp).toISOString().slice(0, 10)

export const normalizeYouTrackDueDateInput = (
  dueDate: Readonly<{ date: string; time?: string }> | undefined,
): string | undefined => {
  if (dueDate === undefined) return undefined
  return dueDate.date
}

const normalizeYouTrackDueDateFilter = (value: string | undefined): string | undefined =>
  value === undefined ? undefined : /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : value.slice(0, 10)

export const normalizeYouTrackListTaskParams = (params: Readonly<ListTasksParams>): ListTasksParams => ({
  ...params,
  dueAfter: normalizeYouTrackDueDateFilter(params.dueAfter),
  dueBefore: normalizeYouTrackDueDateFilter(params.dueBefore),
})
