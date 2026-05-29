// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test, beforeEach, afterEach } from 'bun:test'

import { resolveKonturTalkConfig } from '../../../src/chat/kontur-talk/config.js'

describe('resolveKonturTalkConfig', () => {
  const origEnv = { ...process.env }

  beforeEach(() => {
    process.env['KONTUR_TALK_JWT_TOKEN'] = 'test-jwt-token'
  })

  afterEach(() => {
    process.env = { ...origEnv }
  })

  test('resolves from env when no constructor config provided', () => {
    const config = resolveKonturTalkConfig({})
    expect(config.jwtToken).toBe('test-jwt-token')
    expect(config.platformInstanceId).toBe('kontur-talk-default')
  })

  test('constructor config takes precedence over env', () => {
    const config = resolveKonturTalkConfig({ jwtToken: 'explicit-token' })
    expect(config.jwtToken).toBe('explicit-token')
  })

  test('throws when jwtToken is missing', () => {
    delete process.env['KONTUR_TALK_JWT_TOKEN']
    expect(() => resolveKonturTalkConfig({})).toThrow(/KONTUR_TALK_JWT_TOKEN/iu)
  })

  test('throws when jwtToken is whitespace', () => {
    delete process.env['KONTUR_TALK_JWT_TOKEN']
    expect(() => resolveKonturTalkConfig({ jwtToken: '  ' })).toThrow(/KONTUR_TALK_JWT_TOKEN/iu)
  })

  test('uses custom platformInstanceId when provided', () => {
    const config = resolveKonturTalkConfig({ platformInstanceId: 'custom-id' })
    expect(config.platformInstanceId).toBe('custom-id')
  })
})
