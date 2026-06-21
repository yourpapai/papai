// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { buildDeferredFragment } from '../src/system-prompt-group.js'

const BASE = 'BASE DEFERRED TEXT'

describe('buildDeferredFragment', () => {
  test('returns base text unchanged for non-group context', () => {
    expect(buildDeferredFragment(BASE, 'dm', undefined)).toBe(BASE)
  })

  test('returns base text unchanged when context is undefined', () => {
    expect(buildDeferredFragment(BASE, undefined, undefined)).toBe(BASE)
  })

  test('appends group reminders for group context', () => {
    const result = buildDeferredFragment(BASE, 'group', undefined)
    expect(result).toContain(BASE)
    expect(result).toContain('GROUP REMINDERS')
    expect(result).toContain('mention_user_ids')
  })

  test('includes resolve_chat_participant procedure when tool is enabled', () => {
    const enabled = new Set(['resolve_chat_participant'])
    const result = buildDeferredFragment(BASE, 'group', enabled)
    expect(result).toContain('resolve_chat_participant')
    expect(result).toContain('Resolve all names before creating')
    expect(result).toContain('USER IDs IN THIS GROUP')
  })

  test('omits resolve_chat_participant procedure when tool is not enabled', () => {
    const result = buildDeferredFragment(BASE, 'group', new Set<string>())
    expect(result).not.toContain('resolve_chat_participant')
    expect(result).not.toContain('USER IDs IN THIS GROUP')
  })
})
