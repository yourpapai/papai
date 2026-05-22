// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ToolSet } from 'ai'

import type { ContextType } from '../chat/types.js'
import {
  makeCancelDeferredPromptTool,
  makeCreateDeferredPromptTool,
  makeGetDeferredPromptTool,
  makeListDeferredPromptsTool,
  makeUpdateDeferredPromptTool,
} from '../deferred-prompts/tools.js'

export function addDeferredPromptTools(
  tools: ToolSet,
  chatUserId: string | undefined,
  contextId: string | undefined,
  contextType: ContextType | undefined,
  username: string | null | undefined,
): void {
  if (chatUserId === undefined) return
  const ctxId = contextId ?? chatUserId
  const ctxType = contextType ?? 'dm'
  tools['create_deferred_prompt'] = makeCreateDeferredPromptTool(chatUserId, ctxId, ctxType, username)
  tools['list_deferred_prompts'] = makeListDeferredPromptsTool(chatUserId)
  tools['get_deferred_prompt'] = makeGetDeferredPromptTool(chatUserId)
  tools['update_deferred_prompt'] = makeUpdateDeferredPromptTool(chatUserId)
  tools['cancel_deferred_prompt'] = makeCancelDeferredPromptTool(chatUserId)
}
