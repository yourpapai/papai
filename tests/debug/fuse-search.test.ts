// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import type { LogEntry } from '../../src/debug/schemas.js'

describe('fuse search integration', () => {
  let searchableLogs: Array<{ item: LogEntry; text: string }> = []

  beforeEach(() => {
    searchableLogs = []
  })

  function flattenLogForSearch(entry: LogEntry): string {
    const parts: string[] = [entry.msg]
    if (entry.scope !== undefined) parts.push(entry.scope)

    // Recursively flatten all properties
    function flattenValue(value: unknown, prefix: string): void {
      if (value === null || value === undefined) return
      if (typeof value === 'string') {
        parts.push(value)
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        parts.push(String(value))
      } else if (Array.isArray(value)) {
        for (const item of value) {
          flattenValue(item, prefix)
        }
      } else if (typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) {
          parts.push(k)
          flattenValue(v, `${prefix}.${k}`)
        }
      }
    }

    for (const [key, value] of Object.entries(entry)) {
      if (key === 'msg' || key === 'level' || key === 'time' || key === 'scope') continue
      parts.push(key)
      flattenValue(value, key)
    }

    return parts.join(' ').toLowerCase()
  }

  function addToSearchableLogs(entry: LogEntry): void {
    searchableLogs.push({
      item: entry,
      text: flattenLogForSearch(entry),
    })
  }

  function searchLogs(query: string): LogEntry[] {
    const lowerQuery = query.toLowerCase()
    const results = searchableLogs.filter(({ text }) => text.includes(lowerQuery))
    return results.map((r) => r.item)
  }

  test('searches in message field', () => {
    const entry: LogEntry = {
      time: '2024-01-15T10:30:00.000Z',
      level: 30,
      msg: 'Processing completed successfully',
    }
    addToSearchableLogs(entry)

    expect(searchLogs('completed')).toHaveLength(1)
    expect(searchLogs('failed')).toHaveLength(0)
  })

  test('searches in scope field', () => {
    const entry: LogEntry = {
      time: '2024-01-15T10:30:00.000Z',
      level: 30,
      msg: 'Task created',
      scope: 'scheduler',
    }
    addToSearchableLogs(entry)

    expect(searchLogs('scheduler')).toHaveLength(1)
  })

  test('searches in nested object properties', () => {
    const entry: LogEntry = {
      time: '2024-01-15T10:30:00.000Z',
      level: 30,
      msg: 'API call failed',
      scope: 'provider',
      error: {
        code: 'ECONNREFUSED',
        details: {
          host: 'api.example.com',
          port: 443,
        },
      },
    }
    addToSearchableLogs(entry)

    expect(searchLogs('ECONNREFUSED')).toHaveLength(1)
    expect(searchLogs('api.example.com')).toHaveLength(1)
    expect(searchLogs('443')).toHaveLength(1)
    expect(searchLogs('error')).toHaveLength(1)
    expect(searchLogs('details')).toHaveLength(1)
  })

  test('searches in array values', () => {
    const entry: LogEntry = {
      time: '2024-01-15T10:30:00.000Z',
      level: 30,
      msg: 'Batch processed',
      items: ['item-1', 'item-2', 'item-3'],
    }
    addToSearchableLogs(entry)

    expect(searchLogs('item-2')).toHaveLength(1)
    expect(searchLogs('item-')).toHaveLength(1)
  })

  test('searches in property keys', () => {
    const entry: LogEntry = {
      time: '2024-01-15T10:30:00.000Z',
      level: 30,
      msg: 'Event received',
      userId: 'user-123',
      taskId: 'task-456',
    }
    addToSearchableLogs(entry)

    expect(searchLogs('userId')).toHaveLength(1)
    expect(searchLogs('taskId')).toHaveLength(1)
  })

  test('case insensitive search', () => {
    const entry: LogEntry = {
      time: '2024-01-15T10:30:00.000Z',
      level: 30,
      msg: 'User LOGIN successful',
      userId: 'ADMIN-123',
    }
    addToSearchableLogs(entry)

    expect(searchLogs('login')).toHaveLength(1)
    expect(searchLogs('LOGIN')).toHaveLength(1)
    expect(searchLogs('admin')).toHaveLength(1)
  })

  test('multiple log entries', () => {
    addToSearchableLogs({
      time: '2024-01-15T10:30:00.000Z',
      level: 30,
      msg: 'Task started',
      taskId: 'task-1',
    })
    addToSearchableLogs({
      time: '2024-01-15T10:31:00.000Z',
      level: 30,
      msg: 'Task completed',
      taskId: 'task-2',
    })
    addToSearchableLogs({
      time: '2024-01-15T10:32:00.000Z',
      level: 50,
      msg: 'Error occurred',
      error: { taskId: 'task-1' },
    })

    expect(searchLogs('task-1')).toHaveLength(2)
    expect(searchLogs('task-2')).toHaveLength(1)
    expect(searchLogs('completed')).toHaveLength(1)
  })
})
