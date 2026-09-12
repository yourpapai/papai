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

  test('preserves an explicit API base URL for a platform fake', () => {
    expect(
      resolveKonturTalkConfig({
        jwtToken: 'header.eyJzdWIiOiJib3QifQ.signature',
        platformInstanceId: 'kontur-platform',
        apiBaseUrl: 'http://127.0.0.1:43123/api/v1',
      }).apiBaseUrl,
    ).toBe('http://127.0.0.1:43123/api/v1')
  })

  test('uses the production API base URL by default', () => {
    expect(
      resolveKonturTalkConfig({
        jwtToken: 'header.eyJzdWIiOiJib3QifQ.signature',
        platformInstanceId: 'kontur-platform',
      }).apiBaseUrl,
    ).toBe('https://chat.ktalk.ru/_matrix/client/strangler/api/v1')
  })

  test('normalizes a trailing slash from an API base URL override', () => {
    expect(
      resolveKonturTalkConfig({
        jwtToken: 'header.eyJzdWIiOiJib3QifQ.signature',
        platformInstanceId: 'kontur-platform',
        apiBaseUrl: 'http://127.0.0.1:43123/api/v1/',
      }).apiBaseUrl,
    ).toBe('http://127.0.0.1:43123/api/v1')
  })

  test('throws when an API base URL override is blank', () => {
    expect(() =>
      resolveKonturTalkConfig({
        jwtToken: 'header.eyJzdWIiOiJib3QifQ.signature',
        platformInstanceId: 'kontur-platform',
        apiBaseUrl: '  ',
      }),
    ).toThrow('apiBaseUrl must not be empty')
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
