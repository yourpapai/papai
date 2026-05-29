// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ChatCapability, ChatProviderConfigRequirement, ChatProviderTraits } from '../types.js'

export const konturTalkCapabilities: ReadonlySet<ChatCapability> = new Set<ChatCapability>(['messages.reply-context'])

export const konturTalkTraits: ChatProviderTraits = {
  observedGroupMessages: 'all',
  maxMessageLength: 4096,
}

export const konturTalkConfigRequirements: readonly ChatProviderConfigRequirement[] = [
  { key: 'jwtToken', label: 'Kontur Talk JWT Token', required: true },
]
