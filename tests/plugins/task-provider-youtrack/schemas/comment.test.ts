// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// tests/providers/youtrack/schemas/comment.test.ts
import { describe, expect, test } from 'bun:test'

import { CommentSchema } from '../../../../plugins/task-provider-youtrack/schemas/comment.js'

describe('Comment schemas', () => {
  const validComment = {
    id: '0-0',
    $type: 'IssueComment',
    text: 'This is a comment',
    author: { id: '1-1', $type: 'User', login: 'john.doe' },
    created: 1700000000000,
  }

  test('validates comment with all fields', () => {
    const result = CommentSchema.parse(validComment)
    expect(result.text).toBe('This is a comment')
  })

  test('missing text rejects', () => {
    const { text: _, ...invalid } = validComment
    expect(() => CommentSchema.parse(invalid)).toThrow()
  })

  test('missing author rejects', () => {
    const { author: _, ...invalid } = validComment
    expect(() => CommentSchema.parse(invalid)).toThrow()
  })

  test('missing created rejects', () => {
    const { created: _, ...invalid } = validComment
    expect(() => CommentSchema.parse(invalid)).toThrow()
  })

  test('author as string rejects', () => {
    expect(() => CommentSchema.parse({ ...validComment, author: 'john' })).toThrow()
  })

  test('author missing login rejects', () => {
    expect(() => CommentSchema.parse({ ...validComment, author: { id: '1' } })).toThrow()
  })

  test('text as number rejects', () => {
    expect(() => CommentSchema.parse({ ...validComment, text: 42 })).toThrow()
  })

  test('created as string rejects', () => {
    expect(() => CommentSchema.parse({ ...validComment, created: 'yesterday' })).toThrow()
  })

  test('updated omitted accepts', () => {
    const result = CommentSchema.parse(validComment)
    expect(result.updated).toBeUndefined()
  })

  test('updated null accepts (freshly created comment)', () => {
    const result = CommentSchema.parse({ ...validComment, updated: null })
    expect(result.updated).toBeNull()
  })

  test('deleted as string rejects', () => {
    expect(() => CommentSchema.parse({ ...validComment, deleted: 'true' })).toThrow()
  })

  test('pinned omitted accepts', () => {
    const result = CommentSchema.parse(validComment)
    expect(result.pinned).toBeUndefined()
  })

  test('minimal valid object', () => {
    const minimal = {
      id: '1',
      text: 'hi',
      author: { id: '1', login: 'x' },
      created: 1,
    }
    expect(() => CommentSchema.parse(minimal)).not.toThrow()
  })

  test('full valid with all optionals', () => {
    const full = {
      ...validComment,
      textPreview: 'preview',
      updated: 1700000000001,
      deleted: false,
      pinned: true,
      reactions: [
        {
          id: 'reaction-1',
          reaction: 'thumbs_up',
          author: {
            id: 'user-1',
            login: 'john.doe',
            fullName: 'John Doe',
            email: 'john@example.com',
          },
        },
      ],
    }
    const result = CommentSchema.parse(full)
    expect(result.textPreview).toBe('preview')
    expect(result.deleted).toBe(false)
    expect(result.pinned).toBe(true)
    expect(result.reactions).toHaveLength(1)
  })

  test('empty text accepts (no .min(1))', () => {
    const result = CommentSchema.parse({ ...validComment, text: '' })
    expect(result.text).toBe('')
  })

  test('accepts reaction without fullName (optional)', () => {
    const result = CommentSchema.parse({
      ...validComment,
      reactions: [{ id: 'reaction-1', reaction: 'thumbs_up', author: { id: 'user-1', login: 'john.doe' } }],
    })
    expect(result.reactions).toHaveLength(1)
    expect(result.reactions?.[0]?.author.fullName).toBeUndefined()
  })
})
