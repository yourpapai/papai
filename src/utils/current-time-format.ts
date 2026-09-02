// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ModelMessage } from 'ai'

/**
 * Format a system-provided current-time tag prepended to live user turns.
 *
 * Shape: `<current_time>YYYY-MM-DD HH:MM (Weekday)</current_time>` in 24-hour
 * local wall-clock for the given IANA timezone. On an invalid timezone it
 * degrades to UTC-based formatting with a `(UTC)` weekday-position marker.
 */
export const formatCurrentTimeTag = (date: Date, timezone: string): string => {
  return `<current_time>${formatLocalDateTime(date, timezone)}</current_time>`
}

const CURRENT_TIME_TAG_RE = /<current_time>([^<]*)<\/current_time>/gu

/**
 * Last `<current_time>` tag captured across the string contents of a message
 * list — the freshest time anchor the model's context carried. Non-string
 * content (attachment parts) carries no tag and is skipped.
 */
export const lastCurrentTimeTag = (messages: readonly ModelMessage[]): string | null => {
  let last: string | null = null
  for (const message of messages) {
    if (typeof message.content !== 'string') continue
    for (const match of message.content.matchAll(CURRENT_TIME_TAG_RE)) {
      const captured = match[1]
      if (captured !== undefined && captured.trim() !== '') last = captured
    }
  }
  return last
}

const formatLocalDateTime = (date: Date, timezone: string): string => {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    const parts = formatter.formatToParts(date)
    const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '00'
    const weekday = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'long',
    }).format(date)
    // Some runtimes emit '24' for midnight under hour12:false; normalize to '00'.
    const rawHour = get('hour')
    const hour = rawHour === '24' ? '00' : rawHour
    return `${get('year')}-${get('month')}-${get('day')} ${hour}:${get('minute')} (${weekday})`
  } catch {
    const iso = date.toISOString()
    return `${iso.slice(0, 16).replace('T', ' ')} (UTC)`
  }
}
