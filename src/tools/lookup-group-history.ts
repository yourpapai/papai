// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { tool } from 'ai'
import type { LanguageModel, ModelMessage, ToolSet } from 'ai'
import { generateText } from 'ai'
import { z } from 'zod'

import { getCachedHistory } from '../cache.js'
import { getMainContextIdFromThreadContextId } from '../chat/scoped-context.js'
import { resolveEffectiveLlmConfig } from '../llm-config-resolver.js'
import { logger } from '../logger.js'

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
    const result = await generateText(options)
    return { text: result.text }
  },
  getSmallModel: (configContextId) => {
    const resolved = resolveEffectiveLlmConfig(configContextId)

    if (!resolved.ok) {
      log.warn(
        {
          configContextId,
          source: resolved.source,
          type: resolved.type,
          missing: resolved.type === 'missing' ? resolved.missing : undefined,
          error: resolved.type === 'error' ? resolved.error : undefined,
        },
        'LLM config not available for lookup_group_history',
      )
      return null
    }

    return createOpenAICompatible({
      name: 'openai-compatible',
      apiKey: resolved.llmApiKey,
      baseURL: resolved.llmBaseUrl,
    })(resolved.smallModel)
  },
}

/**
 * Search the main group chat for specific information using AI.
 * Uses small_model to extract relevant information from main chat history.
 */
export async function executeLookupGroupHistory(
  userId: string,
  groupId: string,
  queries: string[],
  deps: LookupGroupHistoryDeps = defaultDeps,
): Promise<string> {
  log.debug({ userId, groupId, queries }, 'Executing lookup_group_history')

  const mainHistory = deps.getCachedHistory(groupId)
  if (mainHistory.length === 0) {
    return 'No messages found in the main chat.'
  }

  const configContextId = getMainContextIdFromThreadContextId(groupId)
  const smallModel = deps.getSmallModel(configContextId)
  if (smallModel === null) {
    log.warn({ userId }, 'No LLM config available for lookup_group_history')
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

    log.info({ userId, groupId, resultLength: result.text.length }, 'lookup_group_history completed')
    return result.text
  } catch (error) {
    log.error(
      { userId, groupId, error: error instanceof Error ? error.message : String(error) },
      'lookup_group_history failed',
    )
    return 'Error searching main chat history.'
  }
}

/**
 * Factory function for lookup_group_history tool
 */
export function makeLookupGroupHistoryTool(userId?: string, contextId?: string): ToolSet[string] {
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
      return executeLookupGroupHistory(userId, groupId, queries)
    },
  })
}
