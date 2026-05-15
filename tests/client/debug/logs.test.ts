// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { flattenLogEntry, updateFuseIndex } from '../../../client/debug/logs.js'
import type { LogEntry } from '../../../src/debug/schemas.js'

describe('logs', () => {
  describe('flattenLogEntry', () => {
    test('flattens simple log entry', () => {
      const entry: LogEntry = {
        time: Date.now(),
        level: 30,
        msg: 'Test message',
      }
      expect(flattenLogEntry(entry)).toBe('Test message')
    })

    test('includes scope in flattened output', () => {
      const entry: LogEntry = {
        time: Date.now(),
        level: 30,
        msg: 'Test message',
        scope: 'test-scope',
      }
      expect(flattenLogEntry(entry)).toBe('Test message test-scope')
    })

    test('flattens extra properties', () => {
      const entry: LogEntry = {
        time: Date.now(),
        level: 30,
        msg: 'Test message',
        userId: 'user-123',
      }
      const result = flattenLogEntry(entry)
      expect(result).toContain('Test message')
      expect(result).toContain('userId')
      expect(result).toContain('user-123')
    })
  })

  describe('updateFuseIndex', () => {
    test('returns a Fuse instance with search() over the log list', () => {
      const logs: LogEntry[] = [
        { time: Date.now(), level: 30, msg: 'Apple pie' },
        { time: Date.now(), level: 30, msg: 'Banana bread' },
      ]
      const fuse = updateFuseIndex(logs)
      expect(fuse).not.toBeNull()
      const results = fuse!.search('apple')
      expect(results.length).toBeGreaterThan(0)
      expect(results[0]!.item.msg).toBe('Apple pie')
    })
  })
})
