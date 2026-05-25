// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ModelMessage, ToolSet } from 'ai'

import { getCachedHistory } from '../cache.js'
import { getConfig } from '../config.js'
import { buildMessagesWithMemory } from '../conversation.js'
import type { TaskProvider } from '../providers/types.js'
import { makeTools } from '../tools/index.js'
import { routeToolsForMessage } from '../tools/tool-router.js'
import { buildMetadataMessages, timezoneOrUtc } from './proactive-llm-helpers.js'
import { buildProactiveTrigger } from './proactive-trigger.js'
import type { ExecutionMetadata } from './types.js'

export function buildFullToolSet(
  provider: TaskProvider,
  createdByUserId: string,
  storageContextId: string,
  contextType: 'dm' | 'group',
  prompt: string,
): { tools: ToolSet; enabledToolNames: ReadonlySet<string> } {
  const fullTools = makeTools(provider, {
    storageContextId,
    chatUserId: createdByUserId,
    mode: 'proactive',
    contextType,
  })
  return { tools: routeToolsForMessage(prompt, fullTools).tools, enabledToolNames: new Set(Object.keys(fullTools)) }
}

export function buildFullMessages(
  createdByUserId: string,
  storageContextId: string,
  type: 'scheduled' | 'alert',
  prompt: string,
  matchedTasksSummary: string | undefined,
  metadata: ExecutionMetadata,
): { messages: ModelMessage[]; systemPrompt: string } {
  const timezone = timezoneOrUtc(getConfig(createdByUserId, 'timezone'))
  const trigger = buildProactiveTrigger(type, prompt, timezone, matchedTasksSummary)
  const history = getCachedHistory(storageContextId)
  const { messages: messagesWithMemory } = buildMessagesWithMemory(storageContextId, history)
  return {
    messages: [
      ...messagesWithMemory,
      { role: 'system', content: trigger.systemContext },
      ...buildMetadataMessages(metadata),
      { role: 'user', content: trigger.userContent },
    ],
    systemPrompt: trigger.systemContext,
  }
}
