// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ChatCapability } from './types.js'

type WithCapabilities = { capabilities: ReadonlySet<ChatCapability> }

/** Returns true if the chat platform supports sending file attachments in replies. */
export function supportsFileReplies(chat: WithCapabilities): boolean {
  return chat.capabilities.has('messages.files')
}

/** Returns true if the chat platform supports a native bot command menu. */
export function supportsCommandMenu(chat: WithCapabilities): boolean {
  return chat.capabilities.has('commands.menu')
}
