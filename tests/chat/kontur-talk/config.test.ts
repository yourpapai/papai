// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { resolveKonturTalkConfig } from '../../../src/chat/kontur-talk/config.js'

describe('resolveKonturTalkConfig', () => {
  test('uses explicit constructor config only', () => {
    const config = resolveKonturTalkConfig({ jwtToken: 'explicit-token', platformInstanceId: 'custom-id' })
    expect(config.jwtToken).toBe('explicit-token')
    expect(config.platformInstanceId).toBe('custom-id')
  })

  test('throws when jwtToken is whitespace', () => {
    expect(() => resolveKonturTalkConfig({ jwtToken: '  ', platformInstanceId: 'custom-id' })).toThrow(
      /KONTUR_TALK_JWT_TOKEN/iu,
    )
  })

  test('throws when jwtToken is missing', () => {
    expect(() => resolveKonturTalkConfig({ platformInstanceId: 'custom-id' })).toThrow(/KONTUR_TALK_JWT_TOKEN/iu)
  })

  test('throws when platformInstanceId is missing', () => {
    expect(() => resolveKonturTalkConfig({ jwtToken: 'explicit-token' })).toThrow('platformInstanceId is required')
  })
})
