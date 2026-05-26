// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ChatProvider } from './types.js'

type SourceInstanceLookup = ChatProvider & {
  getInstance: (id: string) => { readonly provider: ChatProvider } | null
}

function hasSourceInstanceLookup(chat: ChatProvider): chat is SourceInstanceLookup {
  return 'getInstance' in chat && typeof chat.getInstance === 'function'
}

export function resolveSourceChatProvider(chat: ChatProvider, platformInstanceId: string): ChatProvider {
  if (!hasSourceInstanceLookup(chat)) return chat
  const instance = chat.getInstance(platformInstanceId)
  if (instance === null) return chat
  return instance.provider
}

export function resolveSourceProviderName(chat: ChatProvider, platformInstanceId: string): string {
  return resolveSourceChatProvider(chat, platformInstanceId).name
}
