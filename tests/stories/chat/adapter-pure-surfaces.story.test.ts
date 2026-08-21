// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { supportsCommandMenu, supportsFileReplies } from '../../../src/chat/capabilities.js'
import { buildDiscordInteraction } from '../../../src/chat/discord/interaction-helpers.js'
import {
  determineMattermostThreadId,
  normalizeMattermostMessageText,
} from '../../../src/chat/mattermost/message-normalization.js'
import { renderTelegramContext } from '../../../src/chat/telegram/context-renderer.js'
import { scenario } from '../harness/scenario.js'

scenario('SCN-chat-message-normalization: standalone mentions preserve command and thread boundaries', () => {
  expect(normalizeMattermostMessageText('@papai /help today', 'papai')).toEqual({
    text: '/help today',
    isMentioned: true,
    commandInput: '/help today',
  })
  expect(normalizeMattermostMessageText('email@papai.example', 'papai')).toMatchObject({ isMentioned: false })
  expect(determineMattermostThreadId({ id: 'post-1' }, true, 'group', undefined)).toBe('post-1')
  expect(determineMattermostThreadId({ id: 'post-2', root_id: 'root-1' }, false, 'group', 'reply-1')).toBe('root-1')
})

scenario('SCN-chat-context-rendering: Telegram context output distinguishes bounded and unbounded budgets', () => {
  const snapshot = { modelName: 'test-model', totalTokens: 1250, maxTokens: 2000, approximate: false, sections: [] }
  expect(renderTelegramContext(snapshot)).toMatchObject({
    method: 'text',
    content: expect.stringContaining('62.5%') as unknown,
  })
  expect(renderTelegramContext({ ...snapshot, maxTokens: null })).toMatchObject({
    method: 'text',
    content: expect.not.stringMatching(/%/u) as unknown,
  })
})

scenario('SCN-chat-interaction-payload: Discord payloads scope DM and group callbacks without transport', () => {
  const base = {
    user: { id: 'user-1', username: '' },
    customId: 'perm:a:prompt-1',
    channelId: 'channel-1',
    message: { id: 'message-1' },
  }
  expect(buildDiscordInteraction({ ...base, channel: { type: 1 } }, false, 'discord-a')).toMatchObject({
    contextId: 'user-1',
    contextType: 'dm',
    storageContextId: 'user-1',
    platformInstanceId: 'discord-a',
    user: { username: null },
  })
  expect(buildDiscordInteraction({ ...base, channel: { type: 0 } }, true, 'discord-a')).toMatchObject({
    contextId: 'channel-1',
    contextType: 'group',
    storageContextId: 'channel-1',
    user: { isAdmin: true },
  })
  expect(buildDiscordInteraction({ ...base, customId: '', channel: null }, false, 'discord-a')).toBeNull()
})

scenario('SCN-chat-capability-gating: reply features follow declared capability metadata', () => {
  expect(supportsFileReplies({ capabilities: new Set(['messages.files']) })).toBe(true)
  expect(supportsFileReplies({ capabilities: new Set(['messages.buttons']) })).toBe(false)
  expect(supportsCommandMenu({ capabilities: new Set(['commands.menu']) })).toBe(true)
  expect(supportsCommandMenu({ capabilities: new Set(['messages.buttons']) })).toBe(false)
})
