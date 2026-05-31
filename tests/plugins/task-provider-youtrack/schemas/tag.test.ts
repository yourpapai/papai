// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// tests/providers/youtrack/schemas/tag.test.ts
import { describe, expect, test } from 'bun:test'

import { TagSchema } from '../../../../plugins/task-provider-youtrack/schemas/tag.js'

describe('Tag schemas', () => {
  const validTag = {
    id: '0-0',
    $type: 'IssueTag',
    name: 'Bug',
    color: { id: '0-0', $type: 'FieldStyle', background: '#FF0000' },
  }

  test('validates tag', () => {
    const result = TagSchema.parse(validTag)
    expect(result.name).toBe('Bug')
  })

  test('accepts null color', () => {
    expect(() => TagSchema.parse({ id: '0-0', name: 'docs', color: null })).not.toThrow()
  })

  test('missing name rejects', () => {
    const { name: _, ...invalid } = validTag
    expect(() => TagSchema.parse(invalid)).toThrow()
  })

  test('missing id rejects', () => {
    const { id: _, ...invalid } = validTag
    expect(() => TagSchema.parse(invalid)).toThrow()
  })

  test('name as number rejects', () => {
    expect(() => TagSchema.parse({ ...validTag, name: 123 })).toThrow()
  })

  test('color as undefined accepts', () => {
    const { color: _, ...noColor } = validTag
    const result = TagSchema.parse(noColor)
    expect(result.color).toBeUndefined()
  })

  test('color missing required background rejects', () => {
    expect(() => TagSchema.parse({ ...validTag, color: { id: '1' } })).toThrow()
  })

  test('color with only background accepts', () => {
    const result = TagSchema.parse({ ...validTag, color: { background: '#FFF' } })
    expect(result.color?.background).toBe('#FFF')
  })

  test('color.foreground as number rejects', () => {
    expect(() => TagSchema.parse({ ...validTag, color: { background: '#FFF', foreground: 42 } })).toThrow()
  })

  test('untagOnResolve as string rejects', () => {
    expect(() => TagSchema.parse({ ...validTag, untagOnResolve: 'yes' })).toThrow()
  })

  test('owner with valid id accepts', () => {
    const result = TagSchema.parse({ ...validTag, owner: { id: 'u-1' } })
    expect(result.owner?.id).toBe('u-1')
  })

  test('owner missing id rejects', () => {
    expect(() => TagSchema.parse({ ...validTag, owner: {} })).toThrow()
  })

  test('minimal valid', () => {
    const result = TagSchema.parse({ id: '1', name: 'Bug' })
    expect(result.id).toBe('1')
    expect(result.name).toBe('Bug')
  })
})
