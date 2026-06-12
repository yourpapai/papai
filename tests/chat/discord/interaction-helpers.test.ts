// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, it, expect } from 'bun:test'

import {
  buildDiscordInteraction,
  type DiscordInteractionContext,
} from '../../../src/chat/discord/interaction-helpers.js'

describe('buildDiscordInteraction', () => {
  const platformInstanceId = 'discord-default'
  const baseCtx: DiscordInteractionContext = {
    user: { id: '123456', username: 'testuser' },
    customId: 'button:action',
    channelId: 'channel-789',
    channel: { type: 1 },
    message: { id: 'message-abc' },
  }

  it('maps DM interaction correctly (channel.type = 1)', () => {
    const dmCtx: DiscordInteractionContext = {
      ...baseCtx,
      channel: { type: 1 },
    }

    const result = buildDiscordInteraction(dmCtx, false, platformInstanceId)

    expect(result).not.toBeNull()
    expect(result?.kind).toBe('button')
    expect(result?.user.id).toBe('123456')
    expect(result?.user.username).toBe('testuser')
    expect(result?.user.isAdmin).toBe(false)
    expect(result?.contextType).toBe('dm')
    expect(result?.contextId).toBe('123456')
    expect(result?.storageContextId).toBe('123456')
    expect(result?.callbackData).toBe('button:action')
    expect(result?.messageId).toBe('message-abc')
  })

  it('maps group interaction correctly (channel.type = 0)', () => {
    const groupCtx: DiscordInteractionContext = {
      ...baseCtx,
      channel: { type: 0 },
    }

    const result = buildDiscordInteraction(groupCtx, true, platformInstanceId)

    expect(result).not.toBeNull()
    expect(result?.kind).toBe('button')
    expect(result?.user.id).toBe('123456')
    expect(result?.user.username).toBe('testuser')
    expect(result?.user.isAdmin).toBe(true)
    expect(result?.contextType).toBe('group')
    expect(result?.contextId).toBe('channel-789')
    expect(result?.storageContextId).toBe('channel-789')
    expect(result?.callbackData).toBe('button:action')
    expect(result?.messageId).toBe('message-abc')
  })

  it('returns null when customId is empty', () => {
    const emptyCtx: DiscordInteractionContext = {
      ...baseCtx,
      customId: '',
    }

    const result = buildDiscordInteraction(emptyCtx, false, platformInstanceId)

    expect(result).toBeNull()
  })

  it('handles username as empty string (maps to null)', () => {
    const noUsernameCtx: DiscordInteractionContext = {
      ...baseCtx,
      user: { id: '123456', username: '' },
    }

    const result = buildDiscordInteraction(noUsernameCtx, false, platformInstanceId)

    expect(result).not.toBeNull()
    expect(result?.user.username).toBeNull()
  })

  it('handles null channel (falls back to channelId for group context)', () => {
    const nullChannelCtx: DiscordInteractionContext = {
      ...baseCtx,
      channel: null,
    }

    const result = buildDiscordInteraction(nullChannelCtx, false, platformInstanceId)

    expect(result).not.toBeNull()
    expect(result?.contextType).toBe('group')
    expect(result?.contextId).toBe('channel-789')
  })

  it('uses the provided platform instance ID', () => {
    const result = buildDiscordInteraction(baseCtx, false, 'discord-secondary')

    expect(result?.platformInstanceId).toBe('discord-secondary')
  })
})
