// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ChatCapability, ChatProviderConfigRequirement, ChatProviderTraits } from '../types.js'

export const telegramCapabilities: ReadonlySet<ChatCapability> = new Set<ChatCapability>([
  'commands.menu',
  'interactions.callbacks',
  'messages.buttons',
  'messages.files',
  'messages.redact',
  'messages.reply-context',
  'files.receive',
])

export const telegramTraits: ChatProviderTraits = {
  observedGroupMessages: 'all',
  maxMessageLength: 4096,
  callbackDataMaxLength: 64,
}

export const telegramConfigRequirements: readonly ChatProviderConfigRequirement[] = [
  { key: 'TELEGRAM_BOT_TOKEN', label: 'Telegram Bot Token', required: true },
]
