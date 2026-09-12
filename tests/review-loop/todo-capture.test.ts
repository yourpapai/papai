// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { normalizeTodoItems, TODO_TOOLS } from '../../review-loop/src/todo-capture.js'

describe('normalizeTodoItems', () => {
  it('reduces the opencode item shape {content, status, priority} to {content, status}', () => {
    expect(
      normalizeTodoItems({
        todos: [
          { content: 'Locate and read the four artifacts', status: 'in_progress', priority: 'high' },
          { content: 'Edit design.md', status: 'pending', priority: 'high' },
        ],
      }),
    ).toEqual([
      { content: 'Locate and read the four artifacts', status: 'in_progress' },
      { content: 'Edit design.md', status: 'pending' },
    ])
  })

  it('reduces the claude item shape {content, status, activeForm} to {content, status}', () => {
    expect(
      normalizeTodoItems({
        todos: [{ content: 'Write the failing test', status: 'in_progress', activeForm: 'Writing the failing test' }],
      }),
    ).toEqual([{ content: 'Write the failing test', status: 'in_progress' }])
  })

  it('returns null when the input carries no todos array', () => {
    expect(normalizeTodoItems({})).toBeNull()
    expect(normalizeTodoItems({ todos: 'nope' })).toBeNull()
    expect(normalizeTodoItems(null)).toBeNull()
    expect(normalizeTodoItems('todowrite')).toBeNull()
    expect(normalizeTodoItems(undefined)).toBeNull()
  })

  it('keeps an empty array as an empty snapshot', () => {
    expect(normalizeTodoItems({ todos: [] })).toEqual([])
  })

  it('skips malformed items and defaults a missing status to pending', () => {
    expect(
      normalizeTodoItems({
        todos: [null, 'x', { status: 'pending' }, { content: 'kept', status: 'completed' }, { content: 42 }],
      }),
    ).toEqual([{ content: 'kept', status: 'completed' }])
    expect(normalizeTodoItems({ todos: [{ content: 'only content' }] })).toEqual([
      { content: 'only content', status: 'pending' },
    ])
  })
})

describe('TODO_TOOLS', () => {
  it('recognizes exactly the two write tools and never the read tool', () => {
    expect(TODO_TOOLS.has('todowrite')).toBe(true)
    expect(TODO_TOOLS.has('TodoWrite')).toBe(true)
    expect(TODO_TOOLS.has('todoread')).toBe(false)
    expect(TODO_TOOLS.has('read')).toBe(false)
  })
})
