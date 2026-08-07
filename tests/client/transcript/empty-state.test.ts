// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { emptyStateFor } from '../../../client/transcript/empty-state.js'
import type { ViewerStatus } from '../../../client/transcript/transcript.svelte.js'

const ALL: ViewerStatus[] = ['connecting', 'live', 'finished', 'recording-disabled', 'invalid-token', 'error']

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

  test('recording-disabled explains that nothing is retained', () => {
    expect(emptyStateFor('recording-disabled')).toEqual({
      title: 'Live output only',
      hint: 'Nothing is retained for this session. Output appears as it happens and is gone on reload.',
    })
  })

  test('invalid-token points the reader back to chat for a new link', () => {
    expect(emptyStateFor('invalid-token')).toEqual({
      title: 'This link is no longer valid',
      hint: 'Transcript links expire when the session ends or the link is revoked. Ask the bot for a new link in your chat.',
    })
  })

  test('error says reconnection is automatic, so the reader does nothing', () => {
    expect(emptyStateFor('error')).toEqual({
      title: 'Connection lost',
      hint: 'Reconnecting automatically — the page will fill in on its own.',
    })
  })

  test('every status returns copy — no status is a dead end', () => {
    for (const status of ALL) {
      expect(emptyStateFor(status).title.length).toBeGreaterThan(0)
    }
  })

  test('every terminal status carries a hint telling the reader what happens next', () => {
    for (const status of ['recording-disabled', 'invalid-token', 'error'] as const) {
      expect(emptyStateFor(status).hint).toBeTruthy()
    }
  })
})
