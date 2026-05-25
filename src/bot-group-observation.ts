// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { resolveSourceProviderName } from './chat/source-instance.js'
import { toScopedContextId } from './chat/scoped-context.js'
import type { ChatProvider, IncomingMessage } from './chat/types.js'
import {
  upsertGroupAdminObservation,
  upsertGroupUserObservation,
  upsertKnownGroupContext,
} from './group-settings/registry.js'

export function recordGroupObservation(chat: ChatProvider, msg: IncomingMessage): void {
  if (msg.contextType !== 'group') return
  if (msg.commandMatch === undefined && !msg.isMentioned) return
  const provider = resolveSourceProviderName(chat, msg.platformInstanceId)
  const storageContextId = toScopedContextId({ platformInstanceId: msg.platformInstanceId, nativeContextId: msg.contextId })
  let displayName = msg.contextId
  if (msg.contextName !== undefined) displayName = msg.contextName
  let parentName: string | null = null
  if (msg.contextParentName !== undefined) parentName = msg.contextParentName
  upsertKnownGroupContext({ contextId: storageContextId, provider, displayName, parentName })
  upsertGroupAdminObservation({
    provider,
    contextId: storageContextId,
    userId: msg.user.id,
    username: msg.user.username,
    isAdmin: msg.user.isAdmin,
  })
  if (msg.user.displayLabel !== undefined && msg.user.displayLabel !== '') {
    upsertGroupUserObservation({
      provider,
      contextId: storageContextId,
      userId: msg.user.id,
      username: msg.user.username,
      displayLabel: msg.user.displayLabel,
    })
  }
}
