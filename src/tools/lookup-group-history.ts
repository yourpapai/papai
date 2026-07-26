// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { LanguageModel, ModelMessage, Tool } from 'ai'
import { generateText } from 'ai'
import { z } from 'zod'

import { getCachedHistory } from '../cache.js'
import { getMainContextIdFromThreadContextId } from '../chat/scoped-context.js'
import { hoistSystemMessages } from '../llm-message-utils.js'
import { buildChatModel } from '../llm-model-builder.js'
import { resolveLlmConfig } from '../llm-providers/resolver.js'
import { logger } from '../logger.js'
import { toolErrorClass } from './tool-logging.js'

const log = logger.child({ scope: 'tools:lookup-group-history' })

const SYSTEM_PROMPT =
  'You are searching through group chat history. Extract only the information relevant to the queries. Be concise and factual. If no relevant information is found, say "No relevant information found in main chat."'

type GenerateTextResult = {
  text: string
}

export type LookupGroupHistoryDeps = {
  getCachedHistory: typeof getCachedHistory
  generateText: (options: {
    model: LanguageModel
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  }) => Promise<GenerateTextResult>
  getSmallModel: (configContextId: string) => LanguageModel | null
}

const buildUserPrompt = (queries: string[], history: readonly ModelMessage[]): string =>
  `Search queries: ${queries.join(', ')}

Chat history:
${history.map((m) => `${m.role}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`).join('\n')}

Provide a concise answer based only on the chat history.`

const defaultDeps: LookupGroupHistoryDeps = {
  getCachedHistory,
  generateText: async (options) => {
    // AI SDK v7 disallows system messages in the messages array; hoist them into `instructions`.
    const { instructions, messages } = hoistSystemMessages('', options.messages)
    const result = await generateText({ model: options.model, instructions, messages })
    return { text: result.text }
  },
  getSmallModel: (configContextId) => {
    const resolved = resolveLlmConfig(configContextId)

    if (!resolved.ok) {
      log.warn(
        { configContextId, source: resolved.source, type: resolved.type },
        'LLM config not available for lookup_group_history',
      )
      return null
    }

    return buildChatModel(resolved.small.apiKey, resolved.small.baseUrl, resolved.small.model)
  },
}

/**
 * Search the main group chat for specific information using AI.
 * Uses small_model to extract relevant information from main chat history.
 */
export async function executeLookupGroupHistory(
  groupId: string,
  queries: string[],
  deps: LookupGroupHistoryDeps = defaultDeps,
): Promise<string> {
  log.debug('Executing lookup_group_history')

  const mainHistory = deps.getCachedHistory(groupId)
  if (mainHistory.length === 0) {
    return 'No messages found in the main chat.'
  }

  const configContextId = getMainContextIdFromThreadContextId(groupId)
  const smallModel = deps.getSmallModel(configContextId)
  if (smallModel === null) {
    log.warn('No LLM config available for lookup_group_history')
    return 'Unable to search: LLM not configured.'
  }

  try {
    const result = await deps.generateText({
      model: smallModel,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(queries, mainHistory) },
      ],
    })

    log.info({ resultLength: result.text.length }, 'lookup_group_history completed')
    return result.text
  } catch (error) {
    log.error({ errorClass: toolErrorClass(error) }, 'lookup_group_history failed')
    return 'Error searching main chat history.'
  }
}

/**
 * Factory function for lookup_group_history tool
 */
export function makeLookupGroupHistoryTool(userId?: string, contextId?: string): Tool {
  return tool({
    description:
      'Search the main group chat for specific information using AI. Use this when you need context from ongoing discussions outside the current thread, such as finding decisions, context, or references mentioned in the main chat.',
    inputSchema: z.object({
      queries: z
        .array(z.string())
        .describe(
          'Search queries or topics to look for in the group context. Be specific about what you need to find.',
        ),
    }),
    execute: ({ queries }): Promise<string> => {
      if (userId === undefined || contextId === undefined) {
        return Promise.resolve('Unable to search: missing user or context information.')
      }
      const groupId = getMainContextIdFromThreadContextId(contextId)
      return executeLookupGroupHistory(groupId, queries)
    },
  })
}
