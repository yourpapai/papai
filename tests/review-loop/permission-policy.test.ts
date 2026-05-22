// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { decidePermissionOptionId } from '../../review-loop/src/permission-policy.js'

describe('decidePermissionOptionId', () => {
  test('allows all request kinds when an allow option exists', () => {
    const options = [
      { optionId: 'allow-once', kind: 'allow_once' as const },
      { optionId: 'reject-once', kind: 'reject_once' as const },
    ]

    expect(
      decidePermissionOptionId(
        {
          title: 'Edit any file',
          kind: 'edit',
          locations: [{ path: '/etc/passwd' }],
          rawInput: {},
          options,
        },
        '/repo',
      ),
    ).toBe('allow-once')

    expect(
      decidePermissionOptionId(
        {
          title: 'Execute anything',
          kind: 'execute',
          locations: [],
          rawInput: { command: 'rm -rf /' },
          options,
        },
        '/repo',
      ),
    ).toBe('allow-once')

    expect(
      decidePermissionOptionId(
        {
          title: 'Other tool',
          kind: 'other',
          locations: [],
          rawInput: {},
          options,
        },
        '/repo',
      ),
    ).toBe('allow-once')
  })

  test('falls back to first available option when no allow option exists', () => {
    const options = [{ optionId: 'reject-once', kind: 'reject_once' as const }]

    expect(
      decidePermissionOptionId(
        {
          title: 'Edit file',
          kind: 'edit',
          locations: [{ path: 'src/foo.ts' }],
          rawInput: {},
          options,
        },
        '/repo',
      ),
    ).toBe('reject-once')
  })

  test('prefers allow_once over allow_always', () => {
    const options = [
      { optionId: 'allow-always', kind: 'allow_always' as const },
      { optionId: 'allow-once', kind: 'allow_once' as const },
    ]

    expect(
      decidePermissionOptionId(
        {
          title: 'Edit',
          kind: 'edit',
          locations: [{ path: 'src/foo.ts' }],
          rawInput: {},
          options,
        },
        '/repo',
      ),
    ).toBe('allow-once')
  })

  test('throws when no options are provided', () => {
    expect(() =>
      decidePermissionOptionId(
        {
          title: 'Edit',
          kind: 'edit',
          locations: [],
          rawInput: {},
          options: [],
        },
        '/repo',
      ),
    ).toThrow('No permission options provided by the ACP agent')
  })
})
