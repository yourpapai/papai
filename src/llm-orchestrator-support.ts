import { APICallError } from '@ai-sdk/provider'

import type { ReplyFn } from './chat/types.js'
import { getConfig } from './config.js'
import { emit, emitUser } from './debug/event-bus.js'
import { extractAppError, getAppErrorDetails, getUserMessage } from './errors.js'
import { resolveConfigId } from './llm-orchestrator-config.js'
import { logger } from './logger.js'
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
  emit: (event: string, payload: Record<string, unknown>) => void
  log: {
    warn: (context: LogContext, message: string) => void
    error: (context: LogContext, message: string) => void
  }
}

const defaultDeps: LlmOrchestratorSupportDeps = { emit, log }

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
  deps.emit('llm:tool_result', {
    userId: contextId,
    toolName,
    toolCallId,
    durationMs: event.durationMs,
    success: false,
    result: toolFailure,
    error: toolFailure.error,
  })
  if (reply === undefined) return
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
  void reply.text(`⚠️ Tool "${toolName}" failed: ${toolFailure.userMessage}`)
}

const emitToolSuccess = (contextId: string, event: ToolCallFinishEvent, deps: LlmOrchestratorSupportDeps): void => {
  const { toolName, toolCallId } = event.toolCall
  deps.emit('llm:tool_result', {
    userId: contextId,
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
  configContextId: string | undefined,
  error: unknown,
  turnId?: string,
): void => {
  const cfgId = resolveConfigId(contextId, configContextId)
  const model = getConfig(cfgId, 'main_model')
  let emittedModel = 'unknown'
  if (model !== null) {
    emittedModel = model
  }
  emitUser(
    'llm:error',
    contextId,
    {
      error: error instanceof Error ? error.message : String(error),
      model: emittedModel,
    },
    turnId,
  )
}
