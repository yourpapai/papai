// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  konturTalkCapabilities,
  konturTalkTraits,
  konturTalkConfigRequirements,
} from '../../../src/chat/kontur-talk/metadata.js'

describe('Kontur Talk metadata', () => {
  test('capabilities include messages.reply-context', () => {
    expect(konturTalkCapabilities.has('messages.reply-context')).toBe(true)
  })

  test('capabilities do not include messages.buttons', () => {
    expect(konturTalkCapabilities.has('messages.buttons')).toBe(false)
  })

  test('capabilities do not include files.receive', () => {
    expect(konturTalkCapabilities.has('files.receive')).toBe(false)
  })

  test('traits observe all group messages', () => {
    expect(konturTalkTraits.observedGroupMessages).toBe('all')
  })

  test('traits max message length is 4096', () => {
    expect(konturTalkTraits.maxMessageLength).toBe(4096)
  })

  test('config requirements include KONTUR_TALK_JWT_TOKEN', () => {
    expect(konturTalkConfigRequirements).toEqual([
      { key: 'KONTUR_TALK_JWT_TOKEN', label: 'Kontur Talk JWT Token', required: true },
    ])
  })
})
