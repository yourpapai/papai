// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { generateText, stepCountIs, LanguageModel, ModelMessage, ToolSet } from 'ai'

import { getCachedHistory } from '../cache.js'
import { getConfigContextIdFromStorageContextId } from '../chat/scoped-context.js'
import type { DeferredDeliveryTarget } from '../chat/types.js'
import {
  buildVerifiedCompletion,
  detectToolFailure,
  selectReadOnlyTools,
  VERIFIER_MAX_STEPS,
} from '../completion/verified-completion.js'
import type { VerifierDeps, VerifierPrompt } from '../completion/verified-completion.js'
import { buildMessagesWithMemory, runTrimInBackground, shouldTriggerTrim } from '../conversation.js'
import { appendHistory } from '../history.js'
import { logger } from '../logger.js'
import { runMemoryExtractionInBackground } from '../long-term-memory/runner.js'
import { extractFactToolCalls, extractFactToolResults } from '../memory-tool-steps.js'
import { extractFactsFromSdkResults, upsertFact } from '../memory.js'
import type { TaskProvider } from '../providers/types.js'
import { buildProviderlessSystemPrompt, buildSystemPrompt } from '../system-prompt.js'
import type { ExecutionMetadata } from './types.js'

const log = logger.child({ scope: 'deferred:proactive-llm-helpers' })

export const buildProactiveVerification = (
  deps: { generateText: typeof generateText; stepCountIs: typeof stepCountIs },
  model: LanguageModel,
  tools: ToolSet,
  history: readonly ModelMessage[],
): { verifier: VerifierDeps; history: readonly ModelMessage[] } => {
  const readOnlyToolset = selectReadOnlyTools(tools)
  const verifier: VerifierDeps = {
    readOnlyToolset,
    invokeVerifier: async ({ system, messages }: VerifierPrompt) => {
      const res = await deps.generateText({
        model,
        system,
        messages,
        tools: readOnlyToolset ?? {},
        stopWhen: deps.stepCountIs(VERIFIER_MAX_STEPS),
        timeout: 1_200_000,
      })
      return { text: res.text, finishReason: res.finishReason }
    },
  }
  return { verifier, history }
}

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

export const getConfigContextId = (execCtx: DeferredExecutionContextLike): string =>
  getConfigContextIdFromStorageContextId(getStorageContextId(execCtx.deliveryTarget))

export type FullGenerationInput = Readonly<{
  storageContextId: string
  tools: ToolSet
  systemPrompt: string
  messages: ModelMessage[]
}>

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Minimal view of an LLM result needed to decide the user-facing delivery text. */
export type DeliveryResultLike = Readonly<{
  text: string | undefined
  finishReason?: string
  steps?: readonly unknown[]
}>

/**
 * Decide the text to deliver for a fired deferred prompt.
 *
 * A `tool-calls` finish reason means the turn was cut off mid-tool-step (e.g. the model
 * emitted a "let me check the time" preamble and called get_current_time, but the step
 * budget stopped the turn before it produced the real reply). In that case the only text
 * is a preamble, never the answer — drop it instead of leaking it to the user.
 */
export const finalizeDeliveryText = (result: DeliveryResultLike): string => {
  if (result.finishReason === 'tool-calls') return 'Done.'
  if (result.text === undefined || result.text === '') return 'Done.'
  return result.text
}

/**
 * Resolve the user-facing delivery text and log the turn's completion shape. Warns when the
 * turn ended on a pending tool call, because a delivered reminder that stopped mid-tool-step
 * is provably incomplete (its text is a preamble, dropped by finalizeDeliveryText).
 *
 * When a `verification` arg is provided and the result looks risky (empty text, pending
 * tool call, or a tool failure), runs a verify-and-report pass before returning.
 */
export const finalizeAndLog = async (
  result: DeliveryResultLike & { response?: { messages: readonly ModelMessage[] } },
  userId: string,
  mode: ExecutionMetadata['mode'],
  verification?: { verifier: VerifierDeps; history: readonly ModelMessage[] },
): Promise<string> => {
  const stepCount = Array.isArray(result.steps) ? result.steps.length : undefined
  const meta = { userId, mode, finishReason: result.finishReason, stepCount }
  if (result.finishReason === 'tool-calls') {
    log.warn(meta, 'Proactive delivery ended on a pending tool call (step cap reached); verifying before delivery')
  } else {
    log.debug(meta, 'Proactive delivery finalized')
  }

  if (verification !== undefined) {
    const messages = result.response?.messages ?? []
    const hadToolFailure = detectToolFailure(messages)
    const isRisky =
      result.text === undefined || result.text === '' || result.finishReason === 'tool-calls' || hadToolFailure
    if (isRisky) {
      const verified = await buildVerifiedCompletion(
        { history: verification.history, finishReason: result.finishReason, hadToolFailure },
        verification.verifier,
      )
      return verified.text
    }
  }
  return finalizeDeliveryText(result)
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

export const persistLightweightResponse = (
  creatorId: string,
  storageContextId: string,
  configContextId: string,
  mainModel: string,
  assistantMessages: readonly ModelMessage[],
): void => {
  if (assistantMessages.length === 0) return
  const history = getCachedHistory(storageContextId)
  appendHistory(storageContextId, assistantMessages)
  log.debug(
    { userId: creatorId, storageContextId, count: assistantMessages.length },
    'Lightweight response appended to history',
  )
  const updatedHistory = [...history, ...assistantMessages]
  if (shouldTriggerTrim(updatedHistory, mainModel))
    void runTrimInBackground(storageContextId, updatedHistory, undefined, configContextId)
}

export const persistContextResponse = (
  storageContextId: string,
  configContextId: string,
  contextType: 'dm' | 'group',
  history: readonly ModelMessage[],
  mainModel: string,
  assistantMessages: ModelMessage[],
): void => {
  if (assistantMessages.length === 0) return
  appendHistory(storageContextId, assistantMessages)
  const updatedHistory = [...history, ...assistantMessages]
  if (shouldTriggerTrim(updatedHistory, mainModel)) {
    void runTrimInBackground(storageContextId, updatedHistory, undefined, configContextId)
    void runMemoryExtractionInBackground({
      storageContextId,
      configContextId,
      contextType,
      history: updatedHistory,
    })
  }
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
  contextType: 'dm' | 'group',
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
    if (shouldTriggerTrim(updated, mainModel)) {
      void runTrimInBackground(storageContextId, updated, undefined, configContextId)
      void runMemoryExtractionInBackground({
        storageContextId,
        configContextId,
        contextType,
        history: updated,
      })
    }
  }
  log.debug({ userId: creatorId, toolCalls: toolCallCount(result) }, 'Proactive LLM response received')
}
