// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { resolveInvocationText } from '../../review-loop/src/available-commands.js'

describe('resolveInvocationText', () => {
  test('uses the slash command prefix only when the command is advertised', () => {
    expect(resolveInvocationText('/verify-issue', ['verify-issue'], 'Issue body', false)).toBe(
      '/verify-issue Issue body',
    )

    expect(resolveInvocationText('/verify-issue', [], 'Issue body', false)).toBe('Issue body')
  })

  test('prepends a non-slash prefix verbatim with double newline', () => {
    expect(resolveInvocationText('VERIFY:', [], 'Issue body', false)).toBe('VERIFY:\n\nIssue body')
    expect(resolveInvocationText('VERIFY:', ['some-cmd'], 'Issue body', false)).toBe('VERIFY:\n\nIssue body')
  })

  test('returns body unchanged when prefix is null', () => {
    expect(resolveInvocationText(null, [], 'Issue body', false)).toBe('Issue body')
  })

  test('throws when a required slash command is missing', () => {
    expect(() => resolveInvocationText('/review-code', [], 'Issue body', true)).toThrow(
      'Required command /review-code is not advertised by the agent',
    )
  })
})
