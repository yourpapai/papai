// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'

/**
 * Convert a local date+time in a named IANA timezone to a UTC ISO string.
 *
 * Uses date-fns-tz `fromZonedTime` which handles DST correctly. Falls back
 * to treating the time as UTC when the timezone identifier is invalid.
 */
export const localDatetimeToUtc = (date: string, time: string | undefined, timezone: string): string => {
  // fromZonedTime accepts "YYYY-MM-DDTHH:MM:SS" as a local datetime string
  const localStr = `${date}T${time ?? '00:00'}:00`
  try {
    const utcDate = fromZonedTime(localStr, timezone)
    if (Number.isNaN(utcDate.getTime())) {
      // Invalid timezone returned NaN — treat as UTC
      return new Date(`${localStr}Z`).toISOString()
    }
    return utcDate.toISOString()
  } catch {
    // Invalid timezone threw (e.g. empty string) — treat as UTC
    return new Date(`${localStr}Z`).toISOString()
  }
}

// Stable DTSTART anchor: midnight of today in the given timezone, avoiding wall-clock jitter.
export const midnightUtcForTimezone = (timezone: string, now: Date = new Date()): string => {
  try {
    const date = formatInTimeZone(now, timezone, 'yyyy-MM-dd')
    return localDatetimeToUtc(date, '00:00', timezone)
  } catch {
    return localDatetimeToUtc(now.toISOString().slice(0, 10), '00:00', 'UTC')
  }
}

/**
 * Convert a UTC ISO string to a naive local datetime string ("YYYY-MM-DDTHH:MM:SS")
 * for display back to the LLM. No Z suffix — signals local time.
 *
 * Returns null/undefined unchanged. Falls back to the original string
 * when the input cannot be parsed.
 */
export const utcToLocal = (utcIso: string | null | undefined, timezone: string): string | null | undefined => {
  if (utcIso === null || utcIso === undefined) return utcIso
  try {
    return formatInTimeZone(new Date(utcIso), timezone, "yyyy-MM-dd'T'HH:mm:ss")
  } catch {
    return utcIso
  }
}
