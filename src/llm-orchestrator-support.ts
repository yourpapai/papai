// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { APICallError } from '@ai-sdk/provider'
import type { ModelMessage } from 'ai'

import type { AiProgressReporter } from './ai-progress-reporter.js'
import type { ReplyFn } from './chat/types.js'
import { emitUser } from './debug/event-bus.js'
import { extractAppError, getAppErrorDetails, getUserMessage } from './errors.js'
import { saveHistory } from './history.js'
import { createLiveStatusReporter } from './live-status/reporter.js'
import { invokeModelWithTyping } from './llm-orchestrator-invoke.js'
import type { InvokeModelArgs } from './llm-orchestrator-types.js'
import { logger } from './logger.js'
import { extractFactToolCalls, extractFactToolResults } from './memory-tool-steps.js'
import { extractFactsFromSdkResults, upsertFact } from './memory.js'
import { buildToolFailureResult, isToolFailureResult, type ToolFailureResult } from './tool-failure.js'

const log = logger.child({ scope: 'llm-orchestrator:support' })

type LogContext = Record<string, unknown>

type ToolCallFinishEvent = {
  toolCall: { toolName: string; toolCallId: string }
} & Partial<{
  success: boolean
  output: unknown
  error: unknown
  durationMs: number
}>

export interface LlmOrchestratorSupportDeps {
  emit: (event: string, userId: string, payload: Record<string, unknown>) => void
  log: {
    warn: (context: LogContext, message: string) => void
    error: (context: LogContext, message: string) => void
  }
}

const defaultDeps: LlmOrchestratorSupportDeps = { emit: emitUser, log }

const resolveSupportDeps = (deps: LlmOrchestratorSupportDeps | undefined): LlmOrchestratorSupportDeps => {
  if (deps === undefined) {
    return defaultDeps
  }
  return deps
}

const getToolFailureResult = (event: ToolCallFinishEvent): ToolFailureResult | null => {
  if (event.success === true) {
    return isToolFailureResult(event.output) ? event.output : null
  }
  if (event.success !== false) {
    return null
  }
  return buildToolFailureResult(event.error, event.toolCall.toolName, event.toolCall.toolCallId)
}

const emitToolFailure = (
  contextId: string,
  reply: ReplyFn | undefined,
  event: ToolCallFinishEvent,
  toolFailure: ToolFailureResult,
  deps: LlmOrchestratorSupportDeps,
): void => {
  const { toolName, toolCallId } = event.toolCall
  deps.emit('llm:tool_result', contextId, {
    toolName,
    toolCallId,
    durationMs: event.durationMs,
    success: false,
    result: toolFailure,
    error: toolFailure.error,
  })
  deps.log.warn(
    {
      contextId,
      toolName,
      error: toolFailure.error,
      errorType: toolFailure.errorType,
      errorCode: toolFailure.errorCode,
    },
    'Tool execution failed',
  )
  if (reply === undefined) return
  void reply.text(`⚠️ Tool "${toolName}" failed: ${toolFailure.userMessage}`)
}

const emitToolSuccess = (contextId: string, event: ToolCallFinishEvent, deps: LlmOrchestratorSupportDeps): void => {
  const { toolName, toolCallId } = event.toolCall
  deps.emit('llm:tool_result', contextId, {
    toolName,
    toolCallId,
    durationMs: event.durationMs,
    success: true,
    result: event.output,
  })
}

export function handleToolCallFinish(
  ...args:
    | [contextId: string, reply: ReplyFn | undefined, event: ToolCallFinishEvent]
    | [contextId: string, reply: ReplyFn | undefined, event: ToolCallFinishEvent, deps: LlmOrchestratorSupportDeps]
): void {
  const [contextId, reply, event, deps] = args
  const resolvedDeps = resolveSupportDeps(deps)
  const toolFailure = getToolFailureResult(event)
  if (toolFailure !== null) {
    emitToolFailure(contextId, reply, event, toolFailure, resolvedDeps)
    return
  }
  if (event.success !== true) return
  emitToolSuccess(contextId, event, resolvedDeps)
}

export const extractOrchestratorErrorDetails = (error: unknown): Record<string, unknown> => {
  if (APICallError.isInstance(error)) {
    return {
      type: 'APICallError',
      message: error.message,
      statusCode: error.statusCode,
      url: error.url,
      responseBody: error.responseBody,
      responseHeaders: error.responseHeaders,
      isRetryable: error.isRetryable,
      data: error.data,
    }
  }
  const appError = extractAppError(error)
  if (appError !== null) {
    return {
      type: 'AppError',
      errorType: appError.type,
      code: appError.code,
      userMessage: getUserMessage(appError),
      details: getAppErrorDetails(appError),
    }
  }
  if (error instanceof Error) return { type: error.name, message: error.message }
  return { type: 'unknown', value: String(error) }
}

export async function handleOrchestratorMessageError(
  ...args:
    | [reply: ReplyFn, contextId: string, error: unknown]
    | [reply: ReplyFn, contextId: string, error: unknown, deps: LlmOrchestratorSupportDeps]
): Promise<void> {
  const [reply, contextId, error, deps] = args
  const resolvedDeps = resolveSupportDeps(deps)
  resolvedDeps.log.error({ contextId, error: extractOrchestratorErrorDetails(error) }, 'Message handling failed')
  const appError = extractAppError(error)
  if (appError === null) {
    await reply.text(
      APICallError.isInstance(error)
        ? 'API call failed. Please try again.'
        : 'An unexpected error occurred. Please try again later.',
    )
    return
  }
  await reply.text(getUserMessage(appError))
}

export const emitLlmError = (
  contextId: string,
  chatUserId: string,
  contextType: 'dm' | 'group',
  mainModel: string,
  startTime: number,
  messageCount: number,
  error: unknown,
  turnId?: string,
): void => {
  emitUser(
    'llm:error',
    contextId,
    {
      error: error instanceof Error ? error.message : String(error),
      model: mainModel,
      chatUserId,
      contextType,
      durationMs: Date.now() - startTime,
      messageCount,
    },
    turnId,
  )
}

export const logProcessMessage = (
  contextId: string,
  configContextId: string | undefined,
  chatUserId: string,
  userText: string,
  attachmentIds: readonly string[],
  turnId: string,
): void => {
  log.debug(
    { contextId, configContextId, chatUserId, userText, newAttachmentIds: attachmentIds, turnId },
    'processMessage called',
  )
  log.info({ contextId, chatUserId, messageLength: userText.length, turnId }, 'Message received from user')
}

type HandleLlmTurnErrorArgs = {
  reply: ReplyFn
  contextId: string
  chatUserId: string
  contextType: 'dm' | 'group'
  mainModel: string
  startedAt: number
  baseHistory: readonly ModelMessage[]
  error: unknown
  turnId: string
}

export const handleLlmTurnError = async (args: HandleLlmTurnErrorArgs): Promise<void> => {
  const { reply, contextId, chatUserId, contextType, mainModel, startedAt, baseHistory, error, turnId } = args
  emitLlmError(contextId, chatUserId, contextType, mainModel, startedAt, baseHistory.length + 1, error, turnId)
  saveHistory(contextId, baseHistory)
  await handleOrchestratorMessageError(reply, contextId, error)
}

export const persistFactsFromResults = (contextId: string, result: unknown): void => {
  const toolCalls = extractFactToolCalls(result)
  const toolResults = extractFactToolResults(result)
  const newFacts = extractFactsFromSdkResults(toolCalls, toolResults)
  if (newFacts.length === 0) return
  for (const fact of newFacts) upsertFact(contextId, fact)
  log.info(
    { contextId, factsExtracted: newFacts.length, factsUpserted: newFacts.length },
    'Facts extracted and persisted',
  )
}

export const sendLlmResponse = async (
  reply: ReplyFn,
  contextId: string,
  result: {
    text: string | undefined
    finishReason?: string
    toolCalls: unknown[] | undefined
    response: { messages: ModelMessage[] }
  },
  progressReporter: AiProgressReporter | undefined,
): Promise<void> => {
  const textToFormat = result.text !== undefined && result.text !== '' ? result.text : 'Done.'
  const responseLength = result.text === undefined ? 0 : result.text.length
  const toolCallCount = result.toolCalls === undefined ? 0 : result.toolCalls.length
  const meta = { contextId, responseLength, toolCalls: toolCallCount, finishReason: result.finishReason }
  if (result.finishReason === 'tool-calls') {
    log.warn(meta, 'LLM turn ended on a pending tool call (step cap reached); reply may be incomplete')
  }
  await reply.formatted(textToFormat)
  if (progressReporter !== undefined) {
    try {
      await progressReporter.flush()
    } catch (error) {
      log.warn(
        { contextId, error: error instanceof Error ? error.message : String(error) },
        'AI progress details flush failed after final response',
      )
    }
  }
  log.info(meta, 'Response sent successfully')
}

type InvokeWithLiveStatusArgs = {
  reply: ReplyFn
  invokeArgs: InvokeModelArgs & { turnId: string }
  progressReporter: AiProgressReporter
  /** Per-context toggle (ai_live_status); when false, no ephemeral status message is posted. */
  liveStatusEnabled: boolean
}

export const invokeWithLiveStatus = async (
  args: InvokeWithLiveStatusArgs,
): Promise<{ response: { messages: ModelMessage[] } }> => {
  const { reply, invokeArgs, progressReporter, liveStatusEnabled } = args
  const liveStatus = createLiveStatusReporter(reply, { enabled: liveStatusEnabled })
  await liveStatus.start()
  try {
    const result = await invokeModelWithTyping(reply, { ...invokeArgs, liveStatus })
    const toolCallCount = result.toolCalls === undefined ? undefined : result.toolCalls.length
    log.debug(
      { contextId: invokeArgs.contextId, toolCalls: toolCallCount, usage: result.usage },
      'LLM response received',
    )
    progressReporter.reasoning(result.reasoningText, result.reasoning)
    persistFactsFromResults(invokeArgs.contextId, result)
    await liveStatus.dismiss()
    await sendLlmResponse(reply, invokeArgs.contextId, result, progressReporter)
    return result
  } finally {
    await liveStatus.dismiss()
  }
}
