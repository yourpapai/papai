// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { emptyStateFor } from '../../../client/transcript/empty-state.js'

describe('emptyStateFor', () => {
  test('connecting explains that the transcript is still loading', () => {
    expect(emptyStateFor('connecting')).toEqual({ title: 'Loading the transcript…' })
  })

  test('live says the session is running and carries a hint', () => {
    expect(emptyStateFor('live')).toEqual({ title: 'Session is running', hint: 'No output yet.' })
  })

  test('finished says the session produced nothing', () => {
    expect(emptyStateFor('finished')).toEqual({ title: 'This session produced no output' })
  })

  test.each(['recording-disabled', 'invalid-token', 'error'] as const)(
    'returns null for %s, because the banner already carries the whole message',
    (status) => {
      expect(emptyStateFor(status)).toBeNull()
    },
  )
})
