// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { BUILTIN_TOOL_NAMES } from '../../src/tools/builtin-names.js'
import { listToolNames } from '../../src/tools/index.js'
import { TOOL_METADATA } from '../../src/tools/tool-metadata.js'

describe('BUILTIN_TOOL_NAMES', () => {
  test('is a non-empty frozen array', () => {
    expect(Array.isArray(BUILTIN_TOOL_NAMES)).toBe(true)
    expect(BUILTIN_TOOL_NAMES.length).toBeGreaterThan(0)
    expect(Object.isFrozen(BUILTIN_TOOL_NAMES)).toBe(true)
  })

  test('covers well-known core task tools', () => {
    for (const name of ['create_task', 'update_task', 'list_tasks', 'get_task', 'search_tasks']) {
      expect(BUILTIN_TOOL_NAMES).toContain(name)
    }
  })

  test('covers well-known collaboration / comment tools', () => {
    for (const name of ['add_comment', 'get_comments', 'add_watcher', 'add_vote']) {
      expect(BUILTIN_TOOL_NAMES).toContain(name)
    }
  })

  test('stays in sync with TOOL_METADATA keys (single source of truth)', () => {
    expect(BUILTIN_TOOL_NAMES).toEqual(Object.keys(TOOL_METADATA))
  })

  test('contains only snake_case identifiers', () => {
    for (const name of BUILTIN_TOOL_NAMES) {
      expect(name).toMatch(/^[a-z][a-z0-9_]*$/u)
    }
  })
})

describe('listToolNames', () => {
  test('returns the builtin tool name catalog for the closure verifier', () => {
    const names = listToolNames()
    expect(Array.isArray(names)).toBe(true)
    expect(names.length).toBeGreaterThan(0)
    expect(names).toContain('create_task')
    expect(names).toContain('add_comment')
  })

  test('returns the same contents as BUILTIN_TOOL_NAMES', () => {
    expect(listToolNames()).toEqual(BUILTIN_TOOL_NAMES)
  })
})
