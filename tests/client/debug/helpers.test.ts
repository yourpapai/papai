// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  escapeHtml,
  formatTime,
  formatTokens,
  formatUptime,
  levelClass,
  levelName,
} from '../../../client/debug/helpers.js'

describe('dashboard-ui helpers', () => {
  describe('escapeHtml', () => {
    test('escapes special HTML characters', () => {
      expect(escapeHtml('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;')
    })

    test('returns empty string for empty input', () => {
      expect(escapeHtml('')).toBe('')
    })

    test('leaves normal text unchanged', () => {
      expect(escapeHtml('Hello World')).toBe('Hello World')
    })
  })

  describe('levelName', () => {
    test('returns correct level names', () => {
      expect(levelName(10)).toBe('trace')
      expect(levelName(20)).toBe('debug')
      expect(levelName(30)).toBe('info')
      expect(levelName(40)).toBe('warn')
      expect(levelName(50)).toBe('error')
      expect(levelName(60)).toBe('fatal')
    })

    test('returns L{level} for unknown levels', () => {
      expect(levelName(25)).toBe('L25')
    })
  })

  describe('levelClass', () => {
    test('returns correct CSS classes', () => {
      expect(levelClass(10)).toBe('log-debug')
      expect(levelClass(20)).toBe('log-debug')
      expect(levelClass(30)).toBe('log-info')
      expect(levelClass(40)).toBe('log-warn')
      expect(levelClass(50)).toBe('log-error')
      expect(levelClass(60)).toBe('log-error')
    })
  })

  describe('formatTime', () => {
    test('formats timestamp correctly', () => {
      const timestamp = new Date('2024-01-15T10:30:45.123Z').getTime()
      const result = formatTime(timestamp)
      expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/u)
    })

    test('handles ISO string input', () => {
      const result = formatTime('2024-01-15T10:30:45.123Z')
      expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/u)
    })
  })

  describe('formatUptime', () => {
    test('formats hours and minutes', () => {
      const startedAt = Date.now() - 2 * 60 * 60 * 1000 - 30 * 60 * 1000
      expect(formatUptime(startedAt)).toBe('2h30m')
    })

    test('formats minutes and seconds when under an hour', () => {
      const startedAt = Date.now() - 5 * 60 * 1000 - 30 * 1000
      expect(formatUptime(startedAt)).toBe('5m30s')
    })
  })

  describe('formatTokens', () => {
    test('formats thousands with k suffix', () => {
      expect(formatTokens(1500)).toBe('1.5k')
      expect(formatTokens(1000)).toBe('1.0k')
    })

    test('returns number as string for values under 1000', () => {
      expect(formatTokens(999)).toBe('999')
      expect(formatTokens(0)).toBe('0')
    })
  })
})
