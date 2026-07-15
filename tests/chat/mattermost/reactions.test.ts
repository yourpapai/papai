// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { setMattermostReaction } from '../../../src/chat/mattermost/reactions.js'

const BOT_USER_ID = 'bot-1'

function makeRecordingApiFetch(): {
  apiFetch: (method: string, path: string, body: unknown) => Promise<unknown>
  requests: Array<{ readonly method: string; readonly path: string; readonly body: unknown }>
} {
  const requests: Array<{ readonly method: string; readonly path: string; readonly body: unknown }> = []
  const apiFetch = (method: string, path: string, body: unknown): Promise<unknown> => {
    requests.push({ method, path, body })
    return Promise.resolve({})
  }
  return { apiFetch, requests }
}

describe('setMattermostReaction', () => {
  test('swaps a previous reaction for a new one by emoji name', async () => {
    const { apiFetch, requests } = makeRecordingApiFetch()

    const result = await setMattermostReaction(apiFetch, BOT_USER_ID, 'm1', '👀', '⏳')

    expect(result).toBe(true)
    expect(requests).toEqual([
      {
        method: 'DELETE',
        path: `/api/v4/users/${BOT_USER_ID}/posts/m1/reactions/hourglass_flowing_sand`,
        body: undefined,
      },
      {
        method: 'POST',
        path: '/api/v4/reactions',
        body: { user_id: BOT_USER_ID, post_id: 'm1', emoji_name: 'eyes' },
      },
    ])
  })

  test('clears a reaction without adding a new one', async () => {
    const { apiFetch, requests } = makeRecordingApiFetch()

    const result = await setMattermostReaction(apiFetch, BOT_USER_ID, 'm1', null, '✅')

    expect(result).toBe(true)
    expect(requests).toEqual([
      {
        method: 'DELETE',
        path: `/api/v4/users/${BOT_USER_ID}/posts/m1/reactions/white_check_mark`,
        body: undefined,
      },
    ])
  })

  test('returns false when apiFetch throws, never throws itself', async () => {
    const apiFetch = (): Promise<unknown> => {
      throw new Error('network error')
    }

    const result = await setMattermostReaction(apiFetch, BOT_USER_ID, 'm1', '👀', undefined)

    expect(result).toBe(false)
  })

  test('returns false when botUserId is not set', async () => {
    const { apiFetch, requests } = makeRecordingApiFetch()

    const result = await setMattermostReaction(apiFetch, null, 'm1', '👀', undefined)

    expect(result).toBe(false)
    expect(requests).toEqual([])
  })

  test('adds only the new reaction when there is no previous one', async () => {
    const { apiFetch, requests } = makeRecordingApiFetch()

    const result = await setMattermostReaction(apiFetch, BOT_USER_ID, 'm1', '👀', undefined)

    expect(result).toBe(true)
    expect(requests).toEqual([
      {
        method: 'POST',
        path: '/api/v4/reactions',
        body: { user_id: BOT_USER_ID, post_id: 'm1', emoji_name: 'eyes' },
      },
    ])
  })

  test('skips unmapped emoji silently', async () => {
    const { apiFetch, requests } = makeRecordingApiFetch()

    const result = await setMattermostReaction(apiFetch, BOT_USER_ID, 'm1', '🎉', undefined)

    expect(result).toBe(true)
    expect(requests).toEqual([])
  })
})
