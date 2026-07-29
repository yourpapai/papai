// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, it, expect } from 'bun:test'

import { discordCapabilities } from '../../src/chat/discord/metadata.js'
import { konturTalkCapabilities } from '../../src/chat/kontur-talk/metadata.js'
import { mattermostCapabilities } from '../../src/chat/mattermost/metadata.js'
import { telegramCapabilities } from '../../src/chat/telegram/metadata.js'

describe('messages.edit.inbound capability', () => {
  it('present on telegram, discord, mattermost', () => {
    expect(telegramCapabilities.has('messages.edit.inbound')).toBe(true)
    expect(discordCapabilities.has('messages.edit.inbound')).toBe(true)
    expect(mattermostCapabilities.has('messages.edit.inbound')).toBe(true)
  })
  it('absent on kontur-talk', () => {
    expect(konturTalkCapabilities.has('messages.edit.inbound')).toBe(false)
  })
})
