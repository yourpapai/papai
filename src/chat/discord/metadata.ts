// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ChatCapability, ChatProviderConfigRequirement, ChatProviderTraits } from '../types.js'

export const discordCapabilities: ReadonlySet<ChatCapability> = new Set<ChatCapability>([
  'interactions.callbacks',
  'messages.buttons',
  'messages.ephemeral',
  'messages.redact',
  'messages.reply-context',
  'users.resolve',
])

export const discordTraits: ChatProviderTraits = {
  observedGroupMessages: 'mentions_only',
  maxMessageLength: 2000,
  callbackDataMaxLength: 100,
}

export const discordConfigRequirements: readonly ChatProviderConfigRequirement[] = [
  { key: 'token', label: 'Discord Bot Token', required: true },
]
