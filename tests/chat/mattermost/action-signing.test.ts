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
const validNow = 1_800_000_000_000
const validExpiresAt = 1_900_000_000_000

const createSignedContext = (): ReturnType<typeof createMattermostActionContext> =>
  createMattermostActionContext(
    {
      platformInstanceId: 'mattermost-main',
      callbackData: 'perm:a:abc12345',
      sourceMessageText: 'prompt',
      expiresAt: validExpiresAt,
    },
    secret,
  )

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
    const context = createSignedContext()

    const result = verifyMattermostActionContext({ ...context, callbackData: 'perm:d:abc12345' }, secret, validNow)
    expect(result).toEqual({ ok: false, reason: 'bad_signature' })
  })

  test.each([
    ['platform instance id', { platformInstanceId: 'mattermost-secondary' }],
    ['source message text', { sourceMessageText: 'changed prompt' }],
    ['expires at', { expiresAt: validExpiresAt + 1 }],
    ['nonce', { nonce: 'tampered-nonce-value' }],
  ])('rejects tampered %s', (_, patch) => {
    const context = createSignedContext()

    expect(verifyMattermostActionContext({ ...context, ...patch }, secret, validNow)).toEqual({
      ok: false,
      reason: 'bad_signature',
    })
  })

  test('rejects a wrong secret', () => {
    const context = createSignedContext()

    expect(verifyMattermostActionContext(context, 'wrong-secret', validNow)).toEqual({
      ok: false,
      reason: 'bad_signature',
    })
  })

  test.each([
    ['padded signature', (signature: string): string => `${signature}=`],
    ['regular base64 alphabet signature', (signature: string): string => `${signature.slice(0, -1)}+`],
    ['invalid character signature', (signature: string): string => `${signature.slice(0, -1)}*`],
  ])('rejects non-canonical %s', (_, changeSignature) => {
    const context = createSignedContext()

    expect(
      verifyMattermostActionContext({ ...context, signature: changeSignature(context.signature) }, secret, validNow),
    ).toEqual({ ok: false, reason: 'invalid_shape' })
  })

  test('rejects extra fields', () => {
    const context = createSignedContext()

    expect(verifyMattermostActionContext({ ...context, extra: 'unexpected' }, secret, validNow)).toEqual({
      ok: false,
      reason: 'invalid_shape',
    })
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

  test('treats the exact expiration instant as expired', () => {
    const context = createMattermostActionContext(
      {
        platformInstanceId: 'mattermost-main',
        callbackData: 'perm:a:abc12345',
        sourceMessageText: 'prompt',
        expiresAt: 1000,
      },
      secret,
    )

    expect(verifyMattermostActionContext(context, secret, 1000)).toEqual({ ok: false, reason: 'expired' })
  })
})
