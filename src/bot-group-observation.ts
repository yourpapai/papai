// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ChatProvider, IncomingMessage } from './chat/types.js'
import {
  upsertGroupAdminObservation,
  upsertGroupUserObservation,
  upsertKnownGroupContext,
} from './group-settings/registry.js'

export function recordGroupObservation(chat: ChatProvider, msg: IncomingMessage): void {
  if (msg.contextType !== 'group') return
  if (msg.commandMatch === undefined && !msg.isMentioned) return
  const displayName = msg.contextName ?? msg.contextId
  const parentName = msg.contextParentName ?? null
  upsertKnownGroupContext({
    contextId: msg.contextId,
    provider: chat.name,
    displayName,
    parentName,
  })
  upsertGroupAdminObservation({
    provider: chat.name,
    contextId: msg.contextId,
    userId: msg.user.id,
    username: msg.user.username,
    isAdmin: msg.user.isAdmin,
  })
  if (msg.user.displayLabel !== undefined && msg.user.displayLabel !== '') {
    upsertGroupUserObservation({
      provider: chat.name,
      contextId: msg.contextId,
      userId: msg.user.id,
      username: msg.user.username,
      displayLabel: msg.user.displayLabel,
    })
  }
}
