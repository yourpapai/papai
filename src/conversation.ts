// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel, ModelMessage } from 'ai'

import { getCachedHistory, setCachedHistory } from './cache.js'
import { emitUser } from './debug/event-bus.js'
import { resolveEffectiveLlmConfig } from './llm-config-resolver.js'
import { logger } from './logger.js'
import { buildLongTermMemoryContextMessage } from './long-term-memory/context.js'
import { resolveMemoryScope } from './long-term-memory/scope.js'
import { getMemoryProfile, listMemoryRecords } from './long-term-memory/store.js'
import { buildMemoryContextMessage, loadFacts, loadSummary, saveSummary, trimWithMemoryModel } from './memory.js'
import { estimateMessagesTokens, resolveMaxTokens } from './model-context.js'

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
// Trigger a trim once the history is estimated to fill this fraction of the model's
// context window, even if the message-count thresholds have not been reached.
const TOKEN_TRIGGER_RATIO = 0.5

type MessagesWithMemory = {
  messages: ModelMessage[]
  memoryMsg: { role: 'system'; content: string } | null
}

const logTrimConfigFailure = (
  userId: string,
  configContextId: string,
  resolved: Exclude<ReturnType<typeof resolveEffectiveLlmConfig>, { readonly ok: true }>,
): void => {
  log.warn(
    {
      userId,
      configContextId,
      source: resolved.source,
      type: resolved.type,
      missing: resolved.type === 'missing' ? resolved.missing : undefined,
      error: resolved.type === 'error' ? resolved.error : undefined,
    },
    'LLM config not available for background trim',
  )
}

export const buildMessagesWithMemory = (userId: string, history: readonly ModelMessage[]): MessagesWithMemory => {
  const summary = loadSummary(userId)
  const facts = loadFacts(userId)
  const compactedMemoryMsg = buildMemoryContextMessage(summary, facts)
  const scope = resolveMemoryScope({ storageContextId: userId, contextType: 'dm' })
  const profile = getMemoryProfile(scope)?.profile ?? null
  const records = listMemoryRecords({ ...scope, status: 'active', limit: 3 })
  const longTermMemoryMsg = buildLongTermMemoryContextMessage({ profile, records })
  const memoryMessages = [compactedMemoryMsg, longTermMemoryMsg].filter(
    (message): message is { role: 'system'; content: string } => message !== null,
  )
  const memoryMsg =
    memoryMessages.length === 0
      ? null
      : {
          role: 'system' as const,
          content: memoryMessages.map((message) => message.content).join('\n'),
        }
  return { messages: memoryMsg === null ? [...history] : [memoryMsg, ...history], memoryMsg }
}

const exceedsTokenBudget = (history: readonly ModelMessage[], modelName: string | undefined): boolean => {
  if (modelName === undefined) return false
  // Trimming can only shed messages down to TRIM_MIN, so an early token trigger is only
  // useful once there are more than TRIM_MIN messages to choose from.
  if (history.length <= TRIM_MIN) return false
  const maxTokens = resolveMaxTokens(modelName)
  if (maxTokens === null) return false
  return estimateMessagesTokens(history) >= maxTokens * TOKEN_TRIGGER_RATIO
}

export const shouldTriggerTrim = (history: readonly ModelMessage[], modelName?: string): boolean => {
  const userMessageCount = history.filter((m) => m.role === 'user').length
  const periodicTrim = userMessageCount > 0 && userMessageCount % SMART_TRIM_INTERVAL === 0 && history.length > TRIM_MIN
  const hardCapTrim = history.length >= WORKING_MEMORY_CAP
  return periodicTrim || hardCapTrim || exceedsTokenBudget(history, modelName)
}

// Guards against overlapping background trims for the same context: at the hard cap
// every turn would otherwise re-trigger a trim before the previous one persisted, and
// concurrent trims race on setCachedHistory.
const trimsInFlight = new Set<string>()

const performTrim = async (
  userId: string,
  history: readonly ModelMessage[],
  deps: ConversationDeps,
  configContextId: string,
): Promise<void> => {
  const userMessageCount = history.filter((m) => m.role === 'user').length
  const reason =
    history.length >= WORKING_MEMORY_CAP ? 'hard cap reached' : `periodic (${userMessageCount} user messages)`
  log.warn({ userId, historyLength: history.length, reason }, 'Smart trim triggered (running in background)')
  emitUser('trim:start', userId, { historyLength: history.length, reason })

  const resolved = resolveEffectiveLlmConfig(configContextId)

  if (!resolved.ok) {
    logTrimConfigFailure(userId, configContextId, resolved)
    return
  }

  try {
    const existing = loadSummary(userId)
    const model = deps.buildModel(resolved.llmApiKey, resolved.llmBaseUrl, resolved.smallModel)
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
    emitUser('trim:end', userId, {
      error: error instanceof Error ? error.message : String(error),
      success: false,
    })
  }
}

export const runTrimInBackground = async (
  userId: string,
  history: readonly ModelMessage[],
  deps: ConversationDeps = defaultConversationDeps,
  configContextId = userId,
): Promise<void> => {
  if (trimsInFlight.has(userId)) {
    log.debug({ userId }, 'Smart trim already in flight; skipping re-trigger')
    return
  }
  trimsInFlight.add(userId)
  try {
    await performTrim(userId, history, deps, configContextId)
  } finally {
    trimsInFlight.delete(userId)
  }
}
