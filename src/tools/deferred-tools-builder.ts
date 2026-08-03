// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ToolSet } from 'ai'

import type { ContextType } from '../chat/types.js'
import {
  makeCancelReminderTool,
  makeCreateAlertTool,
  makeCreateReminderTool,
  makeGetReminderTool,
  makeListRemindersTool,
  makeUpdateReminderTool,
} from '../deferred-prompts/tools.js'

const getContextId = (contextId: string | undefined, storageOwnerId: string): string => {
  if (contextId !== undefined) return contextId
  return storageOwnerId
}

const getContextType = (contextType: ContextType | undefined): ContextType => {
  if (contextType !== undefined) return contextType
  return 'dm'
}

export function addDeferredPromptTools(
  tools: ToolSet,
  storageOwnerId: string | undefined,
  chatUserId: string | undefined,
  contextId: string | undefined,
  contextType: ContextType | undefined,
  username: string | null | undefined,
  allowTaskConditions = true,
): void {
  if (storageOwnerId === undefined || chatUserId === undefined) return
  const ctxId = getContextId(contextId, storageOwnerId)
  const ctxType = getContextType(contextType)
  tools['create_reminder'] = makeCreateReminderTool(storageOwnerId, ctxId, ctxType, username, chatUserId)
  tools['list_reminders'] = makeListRemindersTool(storageOwnerId)
  tools['get_reminder'] = makeGetReminderTool(storageOwnerId)
  tools['update_reminder'] = makeUpdateReminderTool(storageOwnerId)
  tools['cancel_reminder'] = makeCancelReminderTool(storageOwnerId)
  if (allowTaskConditions) {
    tools['create_alert'] = makeCreateAlertTool(storageOwnerId, ctxId, ctxType, username, chatUserId)
  }
}
