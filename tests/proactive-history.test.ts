// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { ModelMessage } from 'ai'

import { recordProactiveInHistory } from '../src/proactive-history.js'
import { mockLogger } from './utils/test-helpers.js'

describe('recordProactiveInHistory', () => {
  test('appends a faithful assistant message at the given scoped context id', () => {
    mockLogger()
    const calls: Array<{ id: string; msgs: readonly ModelMessage[] }> = []
    recordProactiveInHistory('pi:inst:ctx:user', 'Release v6.8.0 is out', {
      persist: (id, msgs) => {
        calls.push({ id, msgs })
      },
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.id).toBe('pi:inst:ctx:user')
    expect(calls[0]!.msgs).toEqual([{ role: 'assistant', content: 'Release v6.8.0 is out' }])
  })

  test('is best-effort: swallows a persist failure and does not throw', () => {
    mockLogger()
    expect(() =>
      recordProactiveInHistory('pi:inst:ctx:user', 'hi', {
        persist: () => {
          throw new Error('db down')
        },
      }),
    ).not.toThrow()
  })
})
