// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel, ModelMessage } from 'ai'

import { getCachedConfig, getCachedHistory, setCachedHistory } from './cache.js'
import { emitUser } from './debug/event-bus.js'
import { logger } from './logger.js'
import { buildMemoryContextMessage, loadFacts, loadSummary, saveSummary, trimWithMemoryModel } from './memory.js'

const log = logger.child({ scope: 'conversation' })

const buildModel = (apiKey: string, baseUrl: string, modelName: string): LanguageModel =>
  createOpenAICompatible({ name: 'openai-compatible', apiKey, baseURL: baseUrl })(modelName)

export interface ConversationDeps {
  buildModel: (apiKey: string, baseUrl: string, modelName: string) => LanguageModel
}

const defaultConversationDeps: ConversationDeps = {
  buildModel: (apiKey, baseUrl, modelName) => buildModel(apiKey, baseUrl, modelName),
}

const WORKING_MEMORY_CAP = 100
const TRIM_MIN = 50
const TRIM_MAX = 100
const SMART_TRIM_INTERVAL = 10

type MessagesWithMemory = { messages: ModelMessage[]; memoryMsg: { role: 'system'; content: string } | null }

export const buildMessagesWithMemory = (userId: string, history: readonly ModelMessage[]): MessagesWithMemory => {
  const summary = loadSummary(userId)
  const facts = loadFacts(userId)
  const memoryMsg = buildMemoryContextMessage(summary, facts)
  return { messages: memoryMsg === null ? [...history] : [memoryMsg, ...history], memoryMsg }
}

export const shouldTriggerTrim = (history: readonly ModelMessage[]): boolean => {
  const userMessageCount = history.filter((m) => m.role === 'user').length
  const periodicTrim = userMessageCount > 0 && userMessageCount % SMART_TRIM_INTERVAL === 0 && history.length > TRIM_MIN
  const hardCapTrim = history.length >= WORKING_MEMORY_CAP
  return periodicTrim || hardCapTrim
}

export const runTrimInBackground = async (
  userId: string,
  history: readonly ModelMessage[],
  deps: ConversationDeps = defaultConversationDeps,
): Promise<void> => {
  const userMessageCount = history.filter((m) => m.role === 'user').length
  const reason =
    history.length >= WORKING_MEMORY_CAP ? 'hard cap reached' : `periodic (${userMessageCount} user messages)`
  log.warn({ userId, historyLength: history.length, reason }, 'Smart trim triggered (running in background)')
  emitUser('trim:start', userId, { historyLength: history.length, reason })

  const llmApiKey = getCachedConfig(userId, 'llm_apikey')
  const llmBaseUrl = getCachedConfig(userId, 'llm_baseurl')
  const mainModel = getCachedConfig(userId, 'main_model')
  const smallModel = getCachedConfig(userId, 'small_model') ?? mainModel

  if (llmApiKey !== null && llmBaseUrl !== null && smallModel !== null) {
    try {
      const existing = loadSummary(userId)
      const model = deps.buildModel(llmApiKey, llmBaseUrl, smallModel)
      const { trimmedMessages, summary } = await trimWithMemoryModel(history, TRIM_MIN, TRIM_MAX, existing, model)
      // Preserve any messages added to history while the async trim was running
      const currentHistory = getCachedHistory(userId)
      const newMessages = currentHistory.slice(history.length)
      saveSummary(userId, summary)
      setCachedHistory(userId, [...trimmedMessages, ...newMessages])
      log.info({ userId, retained: trimmedMessages.length, preserved: newMessages.length }, 'Smart trim complete')
      emitUser('trim:end', userId, {
        kept: trimmedMessages.length,
        dropped: history.length - trimmedMessages.length,
        success: true,
      })
    } catch (error) {
      log.warn(
        { userId, error: error instanceof Error ? error.message : String(error) },
        'Smart trim failed in background',
      )
      emitUser('trim:end', userId, { error: error instanceof Error ? error.message : String(error), success: false })
    }
  } else {
    log.warn({ userId }, 'LLM config not available for background trim')
  }
}
