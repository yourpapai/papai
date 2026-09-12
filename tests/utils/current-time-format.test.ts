// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { ModelMessage } from 'ai'

import { formatCurrentTimeTag, lastCurrentTimeTag } from '../../src/utils/current-time-format.js'

describe('formatCurrentTimeTag', () => {
  // 2026-05-25T12:00:00Z is a Monday.
  const instant = new Date('2026-05-25T12:00:00Z')

  test('formats date, 24h time and weekday in UTC', () => {
    expect(formatCurrentTimeTag(instant, 'UTC')).toBe('<current_time>2026-05-25 12:00 (Monday)</current_time>')
  })

  test('honors the supplied timezone offset', () => {
    // Asia/Karachi is UTC+5 (no DST): 12:00Z -> 17:00 local.
    expect(formatCurrentTimeTag(instant, 'Asia/Karachi')).toBe('<current_time>2026-05-25 17:00 (Monday)</current_time>')
  })

  test('falls back to UTC-based formatting on an invalid timezone', () => {
    const out = formatCurrentTimeTag(instant, 'Not/AZone')
    expect(out).toBe('<current_time>2026-05-25 12:00 (UTC)</current_time>')
  })

  test('always wraps output in a single current_time tag', () => {
    const out = formatCurrentTimeTag(instant, 'UTC')
    expect(out.startsWith('<current_time>')).toBe(true)
    expect(out.endsWith('</current_time>')).toBe(true)
    expect(out.split('<current_time>').length).toBe(2)
  })

  test('renders midnight as 00:00', () => {
    const midnight = new Date('2026-05-25T00:00:00Z')
    expect(formatCurrentTimeTag(midnight, 'UTC')).toBe('<current_time>2026-05-25 00:00 (Monday)</current_time>')
  })
})

describe('lastCurrentTimeTag', () => {
  test('returns the captured text of the last tag across messages', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: '<current_time>2026-05-25 08:00 (Monday)</current_time> earlier' },
      { role: 'assistant', content: 'no tag here' },
      { role: 'user', content: 'later <current_time>2026-05-25 09:30 (Monday)</current_time>' },
    ]
    expect(lastCurrentTimeTag(messages)).toBe('2026-05-25 09:30 (Monday)')
  })

  test('skips non-string content and keeps scanning later messages', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: [{ type: 'text', text: '<current_time>2026-05-25 08:00 (Monday)</current_time>' }] },
      { role: 'user', content: 'plain <current_time>2026-05-25 09:30 (Monday)</current_time>' },
    ]
    expect(lastCurrentTimeTag(messages)).toBe('2026-05-25 09:30 (Monday)')
  })

  test('returns null when no message carries a usable tag', () => {
    const withoutTags: ModelMessage[] = [{ role: 'user', content: 'no tags at all' }]
    expect(lastCurrentTimeTag(withoutTags)).toBeNull()
    const partsOnly: ModelMessage[] = [
      { role: 'user', content: [{ type: 'text', text: '<current_time>2026-05-25 08:00 (Monday)</current_time>' }] },
    ]
    expect(lastCurrentTimeTag(partsOnly)).toBeNull()
  })

  test('ignores empty captures when picking the last tag', () => {
    const emptyAfterReal: ModelMessage[] = [
      { role: 'user', content: '<current_time>2026-05-25 08:00 (Monday)</current_time> earlier' },
      { role: 'user', content: '<current_time></current_time>' },
    ]
    expect(lastCurrentTimeTag(emptyAfterReal)).toBe('2026-05-25 08:00 (Monday)')
    const emptyOnly: ModelMessage[] = [{ role: 'user', content: '<current_time>   </current_time>' }]
    expect(lastCurrentTimeTag(emptyOnly)).toBeNull()
  })
})
