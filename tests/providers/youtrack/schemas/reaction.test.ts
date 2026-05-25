// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { ReactionSchema } from '../../../../src/providers/youtrack/schemas/reaction.js'

describe('ReactionSchema', () => {
  const validReaction = {
    id: 'reaction-1',
    reaction: 'thumbs_up',
    author: {
      id: 'user-1',
      login: 'alice',
      fullName: 'Alice Example',
      email: 'alice@example.com',
    },
  }

  test('validates a reaction with author details', () => {
    const result = ReactionSchema.parse(validReaction)
    expect(result.id).toBe('reaction-1')
    expect(result.reaction).toBe('thumbs_up')
    expect(result.author.fullName).toBe('Alice Example')
  })

  test('requires id', () => {
    const { id: _, ...invalid } = validReaction
    expect(() => ReactionSchema.parse(invalid)).toThrow()
  })

  test('requires reaction code', () => {
    const { reaction: _, ...invalid } = validReaction
    expect(() => ReactionSchema.parse(invalid)).toThrow()
  })

  test('requires author', () => {
    const { author: _, ...invalid } = validReaction
    expect(() => ReactionSchema.parse(invalid)).toThrow()
  })

  test('accepts author without fullName (optional)', () => {
    const result = ReactionSchema.parse({
      ...validReaction,
      author: { id: 'user-1', login: 'alice' },
    })
    expect(result.author.login).toBe('alice')
    expect(result.author.fullName).toBeUndefined()
  })
})
