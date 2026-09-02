// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getConfigContextIdFromStorageContextId } from './chat/scoped-context.js'
import type { ReplyFn } from './chat/types.js'
import { emitUser } from './debug/event-bus.js'
import { t, type Locale } from './i18n/index.js'
import { logger } from './logger.js'
import {
  isToolFailureResult,
  buildToolFailureResult,
  resolveContextLocale,
  type ToolFailureResult,
} from './tool-failure.js'
import { getContextLanguage } from './utils/config-language.js'

type LogContext = Record<string, unknown>

// Local, looser event shape than the internal ToolCallFinishEvent: the reply
// boundary only reads identity/duration/success/output/error. turnId scopes the
// llm:tool_result to the trace-collector pending of the emitting turn.
type ToolCallFinishEvent = {
  toolCall: { toolName: string; toolCallId: string }
  turnId?: string
} & Partial<{
  success: boolean
  output: unknown
  error: unknown
  durationMs: number
}>

export type LlmToolReplyDeps = {
  emit: (event: string, userId: string, payload: Record<string, unknown>, turnId?: string) => void
  log: {
    warn: (context: LogContext, message: string) => void
    error: (context: LogContext, message: string) => void
  }
}

const log = logger.child({ scope: 'llm-orchestrator:tool-replies' })

const defaultDeps: LlmToolReplyDeps = { emit: emitUser, log }

const resolveDeps = (deps: LlmToolReplyDeps | undefined): LlmToolReplyDeps => {
  if (deps === undefined) {
    return defaultDeps
  }
  return deps
}

const getToolFailureResult = (event: ToolCallFinishEvent, locale: Locale): ToolFailureResult | null => {
  if (event.success === true) {
    return isToolFailureResult(event.output) ? event.output : null
  }
  if (event.success !== false) {
    return null
  }
  return buildToolFailureResult(event.error, event.toolCall.toolName, event.toolCall.toolCallId, { locale })
}

const emitToolFailure = (
  contextId: string,
  reply: ReplyFn | undefined,
  event: ToolCallFinishEvent,
  toolFailure: ToolFailureResult,
  deps: LlmToolReplyDeps,
): void => {
  const { toolName, toolCallId } = event.toolCall
  deps.emit(
    'llm:tool_result',
    contextId,
    {
      toolName,
      toolCallId,
      durationMs: event.durationMs,
      success: false,
      result: toolFailure,
      error: toolFailure.error,
    },
    event.turnId,
  )
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
  void reply.text(
    t('orchestrator.toolFailed', getContextLanguage(getConfigContextIdFromStorageContextId(contextId)), {
      toolName,
      userMessage: toolFailure.userMessage,
    }),
  )
}

const emitToolSuccess = (contextId: string, event: ToolCallFinishEvent, deps: LlmToolReplyDeps): void => {
  const { toolName, toolCallId } = event.toolCall
  deps.emit(
    'llm:tool_result',
    contextId,
    {
      toolName,
      toolCallId,
      durationMs: event.durationMs,
      success: true,
      result: event.output,
    },
    event.turnId,
  )
}

export function handleToolCallFinish(
  ...args:
    | [contextId: string, reply: ReplyFn | undefined, event: ToolCallFinishEvent]
    | [contextId: string, reply: ReplyFn | undefined, event: ToolCallFinishEvent, deps: LlmToolReplyDeps]
): void {
  const [contextId, reply, event, deps] = args
  const resolvedDeps = resolveDeps(deps)
  const locale = resolveContextLocale(getConfigContextIdFromStorageContextId(contextId))
  const toolFailure = getToolFailureResult(event, locale)
  if (toolFailure !== null) {
    emitToolFailure(contextId, reply, event, toolFailure, resolvedDeps)
    return
  }
  if (event.success !== true) return
  emitToolSuccess(contextId, event, resolvedDeps)
}
