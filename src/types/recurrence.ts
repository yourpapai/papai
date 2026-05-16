// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

const BY_DAY = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const

export const isValidTimezone = (tz: string): boolean => {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return fmt !== null
  } catch {
    return false
  }
}

export const recurrenceSpecSchema = z
  .object({
    freq: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']).describe('Recurrence frequency.'),
    interval: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('Interval between occurrences (e.g. interval=2 with freq=WEEKLY = every 2 weeks). Default 1.'),
    byDay: z
      .array(z.enum(BY_DAY))
      .min(1)
      .optional()
      .describe('Weekdays (e.g. ["MO","WE","FR"]). Required for WEEKLY when picking days; optional otherwise.'),
    byMonthDay: z.array(z.number().int().min(1).max(31)).min(1).optional().describe('Days of month (1..31).'),
    byMonth: z.array(z.number().int().min(1).max(12)).min(1).optional().describe('Months (1..12).'),
    byHour: z
      .array(z.number().int().min(0).max(23))
      .min(1)
      .optional()
      .describe('Hours of day (0..23). If omitted, RRULE fires at DTSTART time-of-day — do not pass 0s.'),
    byMinute: z
      .array(z.number().int().min(0).max(59))
      .min(1)
      .optional()
      .describe('Minutes of hour (0..59). If omitted, RRULE fires at DTSTART minute — do not pass 0s.'),
    until: z.iso.datetime().optional().describe('End date (inclusive) in ISO 8601. Mutually exclusive with count.'),
    count: z.number().int().min(1).optional().describe('Total occurrences. Mutually exclusive with until.'),
    dtstart: z.iso.datetime().describe('Anchor datetime in ISO 8601 (UTC).'),
    timezone: z.string().describe('IANA timezone used to interpret local-time fields.'),
  })
  .refine((v) => !(v.until !== undefined && v.count !== undefined), {
    message: 'until and count are mutually exclusive',
    path: ['count'],
  })
  .refine((v) => isValidTimezone(v.timezone), {
    message: 'invalid IANA timezone',
    path: ['timezone'],
  })

export type RecurrenceSpec = z.infer<typeof recurrenceSpecSchema>
