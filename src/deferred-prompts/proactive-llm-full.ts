// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ModelMessage, ToolSet } from 'ai'

import { getCachedHistory } from '../cache.js'
import { getConfigContextIdFromStorageContextId } from '../chat/scoped-context.js'
import { getConfig } from '../config.js'
import { buildMessagesWithMemory } from '../conversation.js'
import type { TaskProvider } from '../providers/types.js'
import { applyToolPreferences, buildProviderlessToolDescriptors, makeTools } from '../tools/index.js'
import { buildMetadataMessages, timezoneOrUtc } from './proactive-llm-helpers.js'
import { buildProactiveTrigger } from './proactive-trigger.js'
import type { ExecutionMetadata } from './types.js'

export async function buildFullToolSet(
  provider: TaskProvider | null,
  createdByUserId: string,
  storageContextId: string,
  contextType: 'dm' | 'group',
  _prompt: string,
): Promise<{ tools: ToolSet; enabledToolNames: ReadonlySet<string> }> {
  const options = {
    storageContextId,
    chatUserId: createdByUserId,
    mode: 'proactive' as const,
    contextType,
  }
  const fullTools =
    provider === null
      ? applyToolPreferences(await buildProviderlessToolDescriptors(options), storageContextId, undefined)
      : await makeTools(provider, options)
  return { tools: fullTools, enabledToolNames: new Set(Object.keys(fullTools)) }
}

export function buildFullMessages(
  createdByUserId: string,
  storageContextId: string,
  type: 'scheduled' | 'alert',
  prompt: string,
  matchedTasksSummary: string | undefined,
  metadata: ExecutionMetadata,
  contextType: 'dm' | 'group' = 'dm',
): { messages: ModelMessage[]; systemPrompt: string } {
  // createdByUserId is the prompt owner id, which may be thread-scoped; strip it to the main
  // config-context key (where the timezone is stored) before the lookup.
  const timezone = timezoneOrUtc(getConfig(getConfigContextIdFromStorageContextId(createdByUserId), 'timezone'))
  const trigger = buildProactiveTrigger(type, prompt, timezone, matchedTasksSummary)
  const history = getCachedHistory(storageContextId)
  const { messages: messagesWithMemory } = buildMessagesWithMemory(storageContextId, history, contextType)
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
