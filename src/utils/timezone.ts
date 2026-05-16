// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Normalizes a user-supplied timezone string to a valid IANA timezone identifier.
 *
 * Accepts:
 * - IANA timezone strings (e.g. "Asia/Karachi", "UTC", "Etc/GMT-5") — passed through unchanged
 * - UTC offset shorthand (e.g. "UTC+5", "UTC-5") — converted to the equivalent Etc/GMT identifier
 *   Note: Etc/GMT signs are inverted relative to UTC offsets (UTC+5 → Etc/GMT-5)
 *
 * Returns null for invalid or unrecognizable values.
 */

const UTC_OFFSET_PATTERN = /^UTC([+-])(\d{1,2})$/

const isValidIana = (value: string): boolean => {
  try {
    Intl.DateTimeFormat([], { timeZone: value })
    return true
  } catch {
    return false
  }
}

export const normalizeTimezone = (value: string): string | null => {
  const match = UTC_OFFSET_PATTERN.exec(value)
  if (match !== null) {
    const sign = match[1]!
    const hours = parseInt(match[2]!, 10)
    if (hours === 0) return 'UTC'
    // Etc/GMT sign convention is inverted: UTC+5 → Etc/GMT-5
    const etcSign = sign === '+' ? '-' : '+'
    const candidate = `Etc/GMT${etcSign}${hours}`
    return isValidIana(candidate) ? candidate : null
  }

  return isValidIana(value) ? value : null
}
