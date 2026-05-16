// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ChatCapability, ChatProviderConfigRequirement, ChatProviderTraits } from '../types.js'

export const mattermostCapabilities: ReadonlySet<ChatCapability> = new Set<ChatCapability>([
  'messages.delete',
  'messages.files',
  'messages.reply-context',
  'files.receive',
  'users.resolve',
])

export const mattermostTraits: ChatProviderTraits = {
  observedGroupMessages: 'all',
  maxMessageLength: 16383,
}

export const mattermostConfigRequirements: readonly ChatProviderConfigRequirement[] = [
  { key: 'MATTERMOST_URL', label: 'Mattermost URL', required: true },
  { key: 'MATTERMOST_BOT_TOKEN', label: 'Mattermost Bot Token', required: true },
]
