// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { discordCapabilities, discordConfigRequirements, discordTraits } from '../../../src/chat/discord/metadata.js'

describe('discord metadata', () => {
  test('capabilities include the core Discord features', () => {
    expect(discordCapabilities.has('messages.buttons')).toBe(true)
    expect(discordCapabilities.has('interactions.callbacks')).toBe(true)
    expect(discordCapabilities.has('users.resolve')).toBe(true)
    expect(discordCapabilities.has('messages.redact')).toBe(true)
  })

  test('declares messages.ephemeral capability', () => {
    expect(discordCapabilities.has('messages.ephemeral')).toBe(true)
  })

  test('capabilities exclude messages.files (not implemented)', () => {
    expect(discordCapabilities.has('messages.files')).toBe(false)
  })

  test('capabilities exclude files.receive (not implemented)', () => {
    expect(discordCapabilities.has('files.receive')).toBe(false)
  })

  test('capabilities exclude commands.menu (Discord has no bot command menu)', () => {
    expect(discordCapabilities.has('commands.menu')).toBe(false)
  })

  test('traits use mentions_only observed group messages and 2000 char cap', () => {
    expect(discordTraits.observedGroupMessages).toBe('mentions_only')
    expect(discordTraits.maxMessageLength).toBe(2000)
  })

  test('config requirements include token', () => {
    const token = discordConfigRequirements.find((r) => r.key === 'token')
    expect(token).toBeDefined()
    expect(token?.required).toBe(true)
  })
})
