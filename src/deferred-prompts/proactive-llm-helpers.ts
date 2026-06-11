// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ModelMessage } from 'ai'

import type { DeferredDeliveryTarget } from '../chat/types.js'
import { buildMessagesWithMemory, runTrimInBackground, shouldTriggerTrim } from '../conversation.js'
import { appendHistory } from '../history.js'
import { logger } from '../logger.js'
import { extractFactToolCalls, extractFactToolResults } from '../memory-tool-steps.js'
import { extractFactsFromSdkResults, upsertFact } from '../memory.js'
import type { TaskProvider } from '../providers/types.js'
import { buildProviderlessSystemPrompt, buildSystemPrompt } from '../system-prompt.js'
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

export type BuildProviderFn = (contextId: string) => Promise<TaskProvider | null> | TaskProvider | null

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

export const getStorageContextId = (target: DeferredDeliveryTarget): string => {
  if (target.storageContextId !== undefined) return target.storageContextId
  if (target.contextType === 'group' && target.threadId !== null) return `${target.contextId}:${target.threadId}`
  return target.contextId
}

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

export const buildContextMessages = (
  storageContextId: string,
  contextType: 'dm' | 'group',
  history: readonly ModelMessage[],
  metadata: ExecutionMetadata,
  prompt: string,
): ModelMessage[] => {
  const { messages: messagesWithMemory } = buildMessagesWithMemory(storageContextId, history, contextType)
  return [...messagesWithMemory, ...buildMetadataMessages(metadata), { role: 'user', content: wrapPrompt(prompt) }]
}

export const persistContextResponse = (
  storageContextId: string,
  configContextId: string,
  history: readonly ModelMessage[],
  mainModel: string,
  assistantMessages: ModelMessage[],
): void => {
  if (assistantMessages.length === 0) return
  appendHistory(storageContextId, assistantMessages)
  const updatedHistory = [...history, ...assistantMessages]
  if (shouldTriggerTrim(updatedHistory, mainModel))
    void runTrimInBackground(storageContextId, updatedHistory, undefined, configContextId)
}

export const buildFullSystemPrompt = (
  provider: TaskProvider | null,
  storageContextId: string,
  enabledToolNames: ReadonlySet<string>,
): string =>
  provider === null
    ? buildProviderlessSystemPrompt(storageContextId, enabledToolNames, { askPermissionAvailable: false })
    : buildSystemPrompt(provider, storageContextId, enabledToolNames, { askPermissionAvailable: false })

export async function resolveFullProvider(
  buildProviderFn: BuildProviderFn,
  userId: string,
  storageContextId: string,
  configContextId: string,
): Promise<TaskProvider | null> {
  const provider = await buildProviderFn(configContextId)
  if (provider !== null) return provider
  log.warn({ userId, storageContextId, configContextId }, 'Could not build task provider for deferred prompt')
  return null
}

type LlmResult = { response: { messages: ModelMessage[] }; text: string; toolCalls: unknown[] | undefined }

export function persistProactiveResults(
  creatorId: string,
  storageContextId: string,
  configContextId: string,
  result: LlmResult,
  history: readonly ModelMessage[],
  mainModel: string,
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
    if (shouldTriggerTrim(updated, mainModel))
      void runTrimInBackground(storageContextId, updated, undefined, configContextId)
  }
  log.debug({ userId: creatorId, toolCalls: toolCallCount(result) }, 'Proactive LLM response received')
}
