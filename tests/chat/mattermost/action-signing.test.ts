// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  createMattermostActionContext,
  verifyMattermostActionContext,
} from '../../../src/chat/mattermost/action-signing.js'

const secret = 'test-secret'

describe('Mattermost action signing', () => {
  test('round-trips a signed context', () => {
    const context = createMattermostActionContext(
      {
        platformInstanceId: 'mattermost-main',
        callbackData: 'perm:a:abc12345',
        sourceMessageText: 'Run `delete_task`?\n\nReason',
        expiresAt: 1_900_000_000_000,
      },
      secret,
    )

    expect(verifyMattermostActionContext(context, secret, 1_800_000_000_000)).toEqual({
      ok: true,
      value: {
        platformInstanceId: 'mattermost-main',
        callbackData: 'perm:a:abc12345',
        sourceMessageText: 'Run `delete_task`?\n\nReason',
        expiresAt: 1_900_000_000_000,
      },
    })
  })

  test('rejects modified callback data', () => {
    const context = createMattermostActionContext(
      {
        platformInstanceId: 'mattermost-main',
        callbackData: 'perm:a:abc12345',
        sourceMessageText: 'prompt',
        expiresAt: 1_900_000_000_000,
      },
      secret,
    )

    const result = verifyMattermostActionContext(
      { ...context, callbackData: 'perm:d:abc12345' },
      secret,
      1_800_000_000_000,
    )
    expect(result).toEqual({ ok: false, reason: 'bad_signature' })
  })

  test('rejects expired contexts', () => {
    const context = createMattermostActionContext(
      {
        platformInstanceId: 'mattermost-main',
        callbackData: 'perm:a:abc12345',
        sourceMessageText: 'prompt',
        expiresAt: 1000,
      },
      secret,
    )

    expect(verifyMattermostActionContext(context, secret, 1001)).toEqual({ ok: false, reason: 'expired' })
  })
})
