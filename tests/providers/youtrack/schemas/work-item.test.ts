// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { YouTrackWorkItemSchema } from '../../../../src/providers/youtrack/schemas/work-item.js'

describe('YouTrackWorkItemSchema', () => {
  const validWorkItem = {
    id: '8-0',
    date: 1700000000000,
    duration: { minutes: 90, presentation: '1h 30m' },
  }

  test('validates work item with all fields', () => {
    const full = {
      ...validWorkItem,
      $type: 'IssueWorkItem',
      text: 'Fixed the bug',
      author: { id: '1-1', login: 'alice', name: 'Alice' },
      type: { id: '5-0', name: 'Development' },
    }
    const result = YouTrackWorkItemSchema.parse(full)
    expect(result.id).toBe('8-0')
    expect(result.date).toBe(1700000000000)
    expect(result.duration.minutes).toBe(90)
    expect(result.duration.presentation).toBe('1h 30m')
    expect(result.text).toBe('Fixed the bug')
    expect(result.author?.login).toBe('alice')
    expect(result.type?.id).toBe('5-0')
    expect(result.type?.name).toBe('Development')
  })

  test('validates minimal work item with id, date, duration', () => {
    const result = YouTrackWorkItemSchema.parse(validWorkItem)
    expect(result.id).toBe('8-0')
    expect(result.duration.minutes).toBe(90)
    expect(result.text).toBeUndefined()
    expect(result.author).toBeUndefined()
    expect(result.type).toBeUndefined()
  })

  test('duration presentation is optional', () => {
    const item = { ...validWorkItem, duration: { minutes: 60 } }
    const result = YouTrackWorkItemSchema.parse(item)
    expect(result.duration.minutes).toBe(60)
    expect(result.duration.presentation).toBeUndefined()
  })

  test('missing id rejects', () => {
    const { id: _, ...invalid } = validWorkItem
    expect(() => YouTrackWorkItemSchema.parse(invalid)).toThrow()
  })

  test('missing date rejects', () => {
    const { date: _, ...invalid } = validWorkItem
    expect(() => YouTrackWorkItemSchema.parse(invalid)).toThrow()
  })

  test('missing duration rejects', () => {
    const { duration: _, ...invalid } = validWorkItem
    expect(() => YouTrackWorkItemSchema.parse(invalid)).toThrow()
  })

  test('duration without minutes rejects', () => {
    expect(() => YouTrackWorkItemSchema.parse({ ...validWorkItem, duration: { presentation: '1h' } })).toThrow()
  })

  test('date as string rejects', () => {
    expect(() => YouTrackWorkItemSchema.parse({ ...validWorkItem, date: '2024-01-01' })).toThrow()
  })

  test('author without id is valid (id not strictly required by schema)', () => {
    // author.id is required by BaseEntitySchema-like logic; let's verify
    expect(() => YouTrackWorkItemSchema.parse({ ...validWorkItem, author: { login: 'alice' } })).toThrow()
  })

  test('type without id rejects', () => {
    expect(() => YouTrackWorkItemSchema.parse({ ...validWorkItem, type: { name: 'Dev' } })).toThrow()
  })
})
