// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ModelMessage, ToolSet } from 'ai'

import { getCachedHistory } from '../cache.js'
import type { DeferredDeliveryTarget } from '../chat/types.js'
import { getConfig } from '../config.js'
import { buildMessagesWithMemory, runTrimInBackground, shouldTriggerTrim } from '../conversation.js'
import { appendHistory } from '../history.js'
import { logger } from '../logger.js'
import { extractFactToolCalls, extractFactToolResults } from '../memory-tool-steps.js'
import { extractFactsFromSdkResults, upsertFact } from '../memory.js'
import type { TaskProvider } from '../providers/types.js'
import { makeTools } from '../tools/index.js'
import { routeToolsForMessage } from '../tools/tool-router.js'
import { buildProactiveTrigger } from './proactive-trigger.js'
import type { ExecutionMetadata } from './types.js'

const log = logger.child({ scope: 'deferred:proactive-llm-helpers' })

export type ProactiveLlmDispatchBaseArgs<TBuildProvider> = readonly [
  DeferredExecutionContextLike,
  'scheduled' | 'alert',
  string,
  ExecutionMetadata,
  TBuildProvider,
]
export type ProactiveLlmDispatchArgs<TDeps, TBuildProvider> =
  | ProactiveLlmDispatchBaseArgs<TBuildProvider>
  | readonly [...ProactiveLlmDispatchBaseArgs<TBuildProvider>, string]
  | readonly [...ProactiveLlmDispatchBaseArgs<TBuildProvider>, undefined, TDeps]
  | readonly [...ProactiveLlmDispatchBaseArgs<TBuildProvider>, string, TDeps]

type DeferredExecutionContextLike = Readonly<{
  createdByUserId: string
  deliveryTarget: DeferredDeliveryTarget
}>

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const resultTextOrDone = (text: string | undefined): string => {
  if (text === undefined) return 'Done.'
  return text
}

export const modelIdForLightweight = (smallModel: string | null, mainModel: string): string => {
  if (smallModel === null) return mainModel
  return smallModel
}

export const timezoneOrUtc = (timezone: string | null): string => {
  if (timezone === null) return 'UTC'
  return timezone
}

export const toolCallCount = (result: unknown): number | undefined => {
  if (!isRecord(result)) return undefined
  const toolCalls = result['toolCalls']
  if (!Array.isArray(toolCalls)) return undefined
  return toolCalls.length
}

export const getStorageContextId = (target: DeferredDeliveryTarget): string =>
  target.contextType === 'group' && target.threadId !== null
    ? `${target.contextId}:${target.threadId}`
    : target.contextId

export function buildMinimalSystemPrompt(type: 'scheduled' | 'alert'): string {
  return [
    '[PROACTIVE EXECUTION]',
    `Trigger type: ${type}`,
    '',
    'A deferred prompt has fired. Deliver the result warmly and conversationally.',
    'Do not mention scheduling, triggers, or system events.',
    'Do not create new deferred prompts.',
  ].join('\n')
}

export function buildMetadataMessages(m: ExecutionMetadata): ModelMessage[] {
  const msgs: ModelMessage[] = [{ role: 'system', content: `[DELIVERY BRIEF]\n${m.delivery_brief}` }]
  if (m.context_snapshot !== null)
    msgs.push({ role: 'system', content: `[CONTEXT FROM CREATION TIME]\n${m.context_snapshot}` })
  return msgs
}

export const wrapPrompt = (prompt: string): string => `===DEFERRED_TASK===\n${prompt}\n===END_DEFERRED_TASK===`

type LlmResult = { response: { messages: ModelMessage[] }; text: string; toolCalls?: unknown[] }

export function persistProactiveResults(
  creatorId: string,
  storageContextId: string,
  result: LlmResult,
  history: readonly ModelMessage[],
): void {
  const newFacts = extractFactsFromSdkResults(extractFactToolCalls(result), extractFactToolResults(result))
  for (const fact of newFacts) upsertFact(storageContextId, fact)
  if (newFacts.length > 0)
    log.info(
      { userId: creatorId, storageContextId, factsExtracted: newFacts.length },
      'Facts persisted from proactive results',
    )

  const msgs = result.response.messages
  if (msgs.length > 0) {
    appendHistory(storageContextId, msgs)
    const updated = [...history, ...msgs]
    if (shouldTriggerTrim(updated)) void runTrimInBackground(storageContextId, updated)
  }
  log.debug({ userId: creatorId, toolCalls: toolCallCount(result) }, 'Proactive LLM response received')
}

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
  return {
    tools: routeToolsForMessage(prompt, fullTools).tools,
    enabledToolNames: new Set(Object.keys(fullTools)),
  }
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
